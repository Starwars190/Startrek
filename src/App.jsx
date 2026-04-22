import { useState, useEffect, useRef } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, ComposedChart, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList
} from "recharts";
import { ClerkProvider, SignedIn, SignedOut, SignIn, SignUp, UserButton, useUser } from "@clerk/clerk-react";

/* ═════════════════════════════════════════════════════════════
   FinSight AI — by Pallav Shah
   v3.4 (April 22, 2026) — Segmented AI Analysis (4 sections)
════════════════════════════════════════════════════════════════ */

const CLERK_PUB_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const C = {
  bgPage:      "#F9F7F4",
  bgSidebar:   "#EFEBE4",
  bgCard:      "#FFFFFF",
  border:      "#E8E1D8",
  borderHover: "#DDD2C2",
  accent:      "#CF6B4E",
  accentDark:  "#A8553C",
  accentLight: "#FDF0EC",
  textPrimary: "#1F1B18",
  textSec:     "#6B6158",
  textMuted:   "#9E9890",
  green:       "#2D7D5C",
  greenBg:     "#F0FAF5",
  red:         "#C04040",
  redBg:       "#FDF2F2",
  amber:       "#A8761F",
  amberBg:     "#FEF7E6",
  blueBg:      "#F0F6FC",
  chartA:      "#CF6B4E",
  chartB:      "#2D7D5C",
  chartC:      "#3B82B0",
  chartD:      "#7C5CB8",
  chartE:      "#D9A441",
  chartF:      "#8B6F47",
  shadow:      "0 1px 3px rgba(0,0,0,.05), 0 2px 8px rgba(0,0,0,.03)",
  shadowMd:    "0 2px 12px rgba(0,0,0,.08), 0 1px 4px rgba(0,0,0,.04)",
};

const API_URL = "/api/claude";
const MODEL   = "claude-sonnet-4-5";

const PERIODS = [
  { id: "latest_quarter", label: "Latest Quarter", short: "Latest Q",  desc: "Most recent quarter" },
  { id: "half_yearly",    label: "Half Yearly",    short: "Half Year", desc: "Last 2 quarters" },
  { id: "1_year",         label: "1 Year",         short: "1 Year",    desc: "Full fiscal year" },
  { id: "2_year",         label: "2 Years",        short: "2 Years",   desc: "YoY comparison" },
  { id: "3_year",         label: "3 Years",        short: "3 Years",   desc: "Medium-term trend" },
  { id: "5_year",         label: "5 Years",        short: "5 Years",   desc: "Long-term history" },
];

const DEFAULT_PERIOD = "1_year";

async function callClaude({ system, userMsg, tools = [], maxTokens = 4000 }) {
  const body = { model: MODEL, max_tokens: maxTokens, messages: [{ role: "user", content: userMsg }] };
  if (system) body.system = system;
  if (tools.length) body.tools = tools;
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "API call failed");
  return json.content.filter(b => b.type === "text").map(b => b.text).join("");
}

function fmtMoney(val, sym = "$") {
  if (val == null || isNaN(val)) return "N/A";
  const abs = Math.abs(val), sign = val < 0 ? "−" : "";
  if (abs >= 1e6)  return `${sign}${sym}${(abs / 1e6).toFixed(2)}T`;
  if (abs >= 1000) return `${sign}${sym}${(abs / 1000).toFixed(1)}B`;
  return `${sign}${sym}${Math.round(abs)}M`;
}

function calcGrowth(arr, idx) {
  if (!arr || idx <= 0 || arr[idx] == null || arr[idx - 1] == null) return null;
  const prev = arr[idx - 1];
  if (prev === 0) return null;
  return ((arr[idx] - prev) / Math.abs(prev)) * 100;
}

const ChartTip = ({ active, payload, label, sym = "$", isPct = false }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 16px", boxShadow: C.shadowMd }}>
      <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 6, fontWeight: 500 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || p.fill, fontSize: 13, fontFamily: "'DM Mono', monospace" }}>
          {p.name}: {isPct || p.name?.toLowerCase().includes("margin") ? `${Number(p.value).toFixed(1)}%` : fmtMoney(p.value, sym)}
        </div>
      ))}
    </div>
  );
};

const US_EX = ["Apple", "Microsoft", "Tesla", "Amazon", "Nvidia", "Meta"];
const IN_EX = ["Reliance Industries", "Infosys", "TCS", "HDFC Bank", "Wipro", "Bajaj Finance"];

const STEPS = [
  "Searching financial databases",
  "Fetching latest financial data",
  "Analyzing profitability trends",
  "Computing key financial ratios",
  "Generating AI insights",
  "Building your dashboard",
];

/* ═════════════════════════════════════════════════════════════
   SYSTEM PROMPT v3.4 — Returns SEGMENTED analysis (4 sections)
   Each section: 3 paragraphs of 2-3 sentences
════════════════════════════════════════════════════════════════ */
function buildSystemPrompt(period) {
  const today = new Date().toISOString().split('T')[0];
  const currentYear = new Date().getFullYear();

  const periodInstructions = {
    latest_quarter: `Return data for the MOST RECENT QUARTER only (target Q3 FY26 or Q4 FY26 if available).
- "years" array: Use quarter labels like ["Q3 FY26"] — just 1 entry
- All financial arrays: 1 value each (the latest quarter)
- Include "prevQuarter" object with previous quarter values for YoY/QoQ comparison`,
    half_yearly: `Return data for the LAST 2 QUARTERS.
- "years" array: Quarter labels like ["Q2 FY26", "Q3 FY26"] — 2 entries
- All financial arrays: 2 values each`,
    "1_year": `Return data for the LAST 4 QUARTERS (full fiscal year).
- "years" array: Quarter labels like ["Q4 FY25", "Q1 FY26", "Q2 FY26", "Q3 FY26"] — 4 entries
- All financial arrays: 4 values each`,
    "2_year": `Return data for the LAST 2 FISCAL YEARS.
- "years" array: ["FY25", "FY26"] — 2 entries
- All financial arrays: 2 values each (annual totals)`,
    "3_year": `Return data for the LAST 3 FISCAL YEARS.
- "years" array: ["FY24", "FY25", "FY26"] — 3 entries
- All financial arrays: 3 values each (annual totals)`,
    "5_year": `Return data for the LAST 5 FISCAL YEARS.
- "years" array: ["FY22", "FY23", "FY24", "FY25", "FY26"] — 5 entries
- All financial arrays: 5 values each (annual totals)`,
  };

  return `You are FinSight AI, a financial research assistant for public companies. Today's date is ${today}.

CRITICAL: You must retrieve the MOST RECENT available data. Current fiscal context:
- Indian companies: FY26 = April 2025 to March 2026 (latest expected: Q3/Q4 FY26)
- US companies: Use calendar year quarters (latest expected: Q3/Q4 ${currentYear})

ANALYSIS PERIOD REQUESTED: ${period.toUpperCase()}
${periodInstructions[period] || periodInstructions["1_year"]}

RESEARCH APPROACH:
1. Perform web searches for latest data from official sources (company IR, BSE/NSE/SEC filings, earnings transcripts)
2. For cost structure: derive from income statement (COGS %, Operating Expenses %, Tax %, Net Profit %)
3. For EPS: use diluted EPS when available

OUTPUT: Return ONLY raw JSON. No markdown, no backticks.

Return this exact structure (monetary values in MILLIONS of local currency, percentages as numbers like 23.5 not 0.235):
{
  "company": "Full Official Company Name",
  "ticker": "SYMBOL",
  "market": "US or India or other",
  "exchange": "NYSE/NASDAQ/NSE/BSE/LSE etc",
  "currency": "USD or INR etc",
  "currencySymbol": "$ or ₹ etc",
  "sector": "sector name",
  "description": "2 sentences about what the company does",
  "periodType": "${period}",
  "dataAsOf": "YYYY-MM-DD",
  "years": [label, label, ...],
  "revenue": [n, n, ...],
  "netIncome": [n, n, ...],
  "ebitda": [n, n, ...],
  "freeCashFlow": [n, n, ...],
  "grossMargin": [n, n, ...],
  "netMargin": [n, n, ...],
  "eps": [n, n, ...],
  "costStructure": [
    { "cogsPct": n, "opexPct": n, "taxPct": n, "netProfitPct": n, "otherPct": n }
  ],
  "marketCap": number,
  "peRatio": number,
  "revenueCAGR": number,
  ${period === "latest_quarter" ? '"prevQuarter": {"revenue": n, "netIncome": n, "ebitda": n, "freeCashFlow": n, "grossMargin": n, "netMargin": n, "label": "Q2 FY26"},' : ''}

  "analysisRevenue": [
    "First paragraph (2-3 sentences) about revenue trends, growth rates, and key drivers. Include specific numbers.",
    "Second paragraph (2-3 sentences) about segment/geographic breakdown or major revenue influences. Include specific numbers.",
    "Third paragraph (2-3 sentences) about forward revenue trajectory, guidance, or growth catalysts. Include specific numbers."
  ],
  "analysisProfitability": [
    "First paragraph (2-3 sentences) about margin performance (gross, operating, net). Include specific percentages and comparisons.",
    "Second paragraph (2-3 sentences) about cost dynamics, pricing power, or operating leverage. Include specific numbers.",
    "Third paragraph (2-3 sentences) about profitability trajectory and what's driving expansion or compression. Include specific numbers."
  ],
  "analysisCashFlow": [
    "First paragraph (2-3 sentences) about free cash flow generation and cash conversion. Include specific numbers.",
    "Second paragraph (2-3 sentences) about capex intensity, working capital, or cash deployment. Include specific numbers.",
    "Third paragraph (2-3 sentences) about balance sheet strength, liquidity, or financial flexibility. Include specific numbers."
  ],
  "analysisOutlook": [
    "First paragraph (2-3 sentences) about competitive position and market share dynamics. Include specific context.",
    "Second paragraph (2-3 sentences) about strategic initiatives, moats, or structural advantages. Include specific details.",
    "Third paragraph (2-3 sentences) about forward-looking risks, opportunities, or key monitorables. Include specific catalysts."
  ],

  "analysis": "Combined summary of all 4 sections in 2-3 paragraphs for backward compatibility",

  "keyStrengths": ["strength with data", "strength with data", "strength with data"],
  "keyRisks": ["risk with context", "risk with context", "risk with context"],
  "outlook": "Positive or Mixed or Caution",
  "outlookReason": "One concise sentence"
}

IMPORTANT NOTES:
- ALL financial arrays must have the SAME NUMBER of entries as "years"
- Each analysis section must contain EXACTLY 3 strings, each being 2-3 sentences
- Analysis strings must be substantive with specific numbers, percentages, comparisons
- costStructure: One object per period matching years array length
- cogsPct + opexPct + taxPct + netProfitPct + otherPct should total ~100
- If a metric is unavailable, use null (not 0)
- EPS: in rupees/dollars per share (not millions)`;
}

const FinSightLogo = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="fs-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"  stopColor="#E48164"/>
        <stop offset="100%" stopColor="#B85A3A"/>
      </linearGradient>
    </defs>
    <rect width="40" height="40" rx="10" fill="url(#fs-grad)"/>
    <path d="M9 28 L16 22 L23 25 L31 13" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    <circle cx="9"  cy="28" r="1.8" fill="white"/>
    <circle cx="16" cy="22" r="1.8" fill="white"/>
    <circle cx="23" cy="25" r="1.8" fill="white"/>
    <circle cx="31" cy="13" r="4.5" fill="white" fillOpacity=".22"/>
    <circle cx="31" cy="13" r="2.4" fill="white"/>
  </svg>
);

const Spinner = () => (
  <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${C.accentLight}`, borderTopColor: C.accent, animation: "fs-spin .8s linear infinite" }} />
);

const MetricCard = ({ label, value, sub, accent }) => (
  <div className="fs-card fs-metric" style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 12px", boxShadow: C.shadow, transition: "all .2s", minWidth: 0 }}>
    <div style={{ color: C.textMuted, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 16, fontWeight: 500, color: accent || C.textPrimary, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    <div style={{ color: C.textMuted, fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>
  </div>
);

const Byline = () => (
  <span style={{ color: C.textMuted, fontSize: 11.5, letterSpacing: ".3px" }}>
    by <span style={{ fontWeight: 600, color: C.accent }}>Pallav Shah</span>
  </span>
);

/* ═════════════════════════════════════════════════════════════
   CHART FRAME — Consistent wrapper with Quick Read
════════════════════════════════════════════════════════════════ */
function ChartFrame({ icon, title, subtitle, children, quickRead, quickReadColor }) {
  return (
    <div className="fs-chart-card" style={{
      background: C.bgCard,
      border: `1px solid ${C.border}`,
      borderRadius: 16,
      padding: 22,
      boxShadow: C.shadow,
      display: "flex",
      flexDirection: "column",
      gap: 14,
    }}>
      <div>
        <div style={{
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          fontWeight: 700,
          fontSize: 15,
          color: C.textPrimary,
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 4,
        }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          <span>{title}</span>
        </div>
        <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.5 }}>{subtitle}</div>
      </div>
      <div style={{ flex: 1 }}>{children}</div>
      {quickRead && (
        <div style={{
          background: quickReadColor || C.accentLight,
          borderLeft: `3px solid ${quickReadColor ? C.green : C.accent}`,
          borderRadius: 6,
          padding: "10px 14px",
          fontSize: 12.5,
          lineHeight: 1.6,
          color: C.textSec,
        }}>
          <span style={{
            color: quickReadColor ? C.green : C.accent,
            fontWeight: 700,
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: ".8px",
            display: "block",
            marginBottom: 3,
          }}>💡 Quick Read</span>
          {quickRead}
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   CHART 1: GROWTH QUALITY
════════════════════════════════════════════════════════════════ */
function GrowthQualityChart({ data, sym }) {
  const hasData = data.revenue?.some(v => v != null);
  if (!hasData) return null;
  const chartData = data.years.map((y, i) => ({
    year: String(y),
    Revenue: data.revenue?.[i],
    "Gross Margin": data.grossMargin?.[i],
    "Net Margin": data.netMargin?.[i],
  }));
  const axisStyle = { fontSize: 11, fill: C.textMuted };
  const gridStyle = { strokeDasharray: "4 4", stroke: C.border };
  const dataLen = chartData.length;
  const firstMargin = data.netMargin?.[0];
  const lastMargin = data.netMargin?.[dataLen - 1];
  const marginTrend = lastMargin != null && firstMargin != null ? lastMargin - firstMargin : null;
  const revenueTrend = calcGrowth(data.revenue, dataLen - 1);
  let quickRead, quickColor;
  if (dataLen === 1) {
    quickRead = `Revenue ${fmtMoney(data.revenue[0], sym)} with net margin of ${data.netMargin?.[0]?.toFixed(1) || "N/A"}%. Compare with industry peers to judge quality.`;
  } else if (marginTrend != null && revenueTrend != null) {
    if (revenueTrend > 0 && marginTrend >= -0.5) { quickRead = "Revenue is growing AND margins are stable/expanding — this is high-quality growth."; quickColor = C.greenBg; }
    else if (revenueTrend > 0 && marginTrend < -0.5) { quickRead = "Revenue growing BUT margins shrinking — growth may be coming at the cost of profitability. Watch this."; }
    else if (revenueTrend < 0) { quickRead = "Revenue declining. Check if margins are holding to understand if it's a temporary or structural issue."; }
    else { quickRead = "Stable performance. Look at both revenue trajectory and margin trend together to judge quality."; }
  } else { quickRead = "Compare revenue bars with margin lines. Both rising = quality growth. Bars up but lines down = warning."; }

  return (
    <ChartFrame icon="📊" title="Growth Quality" subtitle="Revenue (bars) plotted against profit margins (lines). The best companies grow revenue WHILE maintaining or improving margins." quickRead={quickRead} quickReadColor={quickColor}>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={chartData} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="gqBar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.chartA} stopOpacity={.9}/>
              <stop offset="100%" stopColor={C.chartA} stopOpacity={.45}/>
            </linearGradient>
          </defs>
          <CartesianGrid {...gridStyle} />
          <XAxis dataKey="year" tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis yAxisId="left" tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={v => fmtMoney(v, "")} width={44} />
          <YAxis yAxisId="right" orientation="right" tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} width={40} />
          <Tooltip content={<ChartTip sym={sym} />} />
          <Legend wrapperStyle={{ fontSize: 11.5, color: C.textSec, paddingTop: 8 }} />
          <Bar yAxisId="left" dataKey="Revenue" fill="url(#gqBar)" radius={[6, 6, 0, 0]} barSize={dataLen <= 2 ? 60 : dataLen <= 4 ? 40 : 28} />
          <Line yAxisId="right" type="monotone" dataKey="Gross Margin" stroke={C.chartC} strokeWidth={2.6} dot={{ fill: C.chartC, r: 4, strokeWidth: 2, stroke: "#fff" }} />
          <Line yAxisId="right" type="monotone" dataKey="Net Margin" stroke={C.chartD} strokeWidth={2.6} dot={{ fill: C.chartD, r: 4, strokeWidth: 2, stroke: "#fff" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/* ═════════════════════════════════════════════════════════════
   CHART 2: CASH QUALITY
════════════════════════════════════════════════════════════════ */
function CashQualityChart({ data, sym }) {
  const hasData = data.netIncome?.some(v => v != null) && data.freeCashFlow?.some(v => v != null);
  if (!hasData) return null;
  const chartData = data.years.map((y, i) => ({
    year: String(y),
    "Net Income": data.netIncome?.[i],
    "Free Cash Flow": data.freeCashFlow?.[i],
  }));
  const axisStyle = { fontSize: 11, fill: C.textMuted };
  const gridStyle = { strokeDasharray: "4 4", stroke: C.border };
  const dataLen = chartData.length;
  const latestNI = data.netIncome?.[dataLen - 1];
  const latestFCF = data.freeCashFlow?.[dataLen - 1];
  let quickRead, quickColor;
  if (latestNI != null && latestFCF != null && latestNI !== 0) {
    const ratio = latestFCF / latestNI;
    if (ratio >= 0.9) { quickRead = "Free Cash Flow matches Net Income — profits are converting to real cash. This is a healthy sign."; quickColor = C.greenBg; }
    else if (ratio >= 0.6) { quickRead = "Cash flow is moderately lower than reported profits. Normal for some industries, but monitor the gap."; }
    else if (ratio >= 0.3) { quickRead = "Significant gap between profits and cash. Could indicate heavy reinvestment OR accounting-heavy earnings."; }
    else { quickRead = "Cash flow is much lower than profits. Understand where the gap is coming from — it's a potential red flag."; quickColor = C.redBg; }
  } else { quickRead = "If cash flow bars are similar to net income bars, profits are real cash. Much lower = caution sign."; }

  return (
    <ChartFrame icon="💰" title="Cash Quality Check" subtitle="Compares reported profits (Net Income) with actual cash generated (Free Cash Flow). Matching = real profits." quickRead={quickRead} quickReadColor={quickColor}>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} barGap={6} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="cqNI" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.chartB} stopOpacity={.9}/><stop offset="100%" stopColor={C.chartB} stopOpacity={.5}/></linearGradient>
            <linearGradient id="cqFCF" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.chartC} stopOpacity={.9}/><stop offset="100%" stopColor={C.chartC} stopOpacity={.5}/></linearGradient>
          </defs>
          <CartesianGrid {...gridStyle} />
          <XAxis dataKey="year" tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={v => fmtMoney(v, "")} width={44} />
          <Tooltip content={<ChartTip sym={sym} />} />
          <Legend wrapperStyle={{ fontSize: 11.5, color: C.textSec, paddingTop: 8 }} />
          <Bar dataKey="Net Income" fill="url(#cqNI)" radius={[6, 6, 0, 0]} barSize={dataLen <= 2 ? 55 : 35}>
            {dataLen <= 4 && <LabelList dataKey="Net Income" position="top" formatter={(v) => fmtMoney(v, "")} style={{ fill: C.chartB, fontSize: 10, fontWeight: 600 }} />}
          </Bar>
          <Bar dataKey="Free Cash Flow" fill="url(#cqFCF)" radius={[6, 6, 0, 0]} barSize={dataLen <= 2 ? 55 : 35}>
            {dataLen <= 4 && <LabelList dataKey="Free Cash Flow" position="top" formatter={(v) => fmtMoney(v, "")} style={{ fill: C.chartC, fontSize: 10, fontWeight: 600 }} />}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/* ═════════════════════════════════════════════════════════════
   CHART 3: PROFIT STRUCTURE (pie for 1 period, stacked bars for multi)
════════════════════════════════════════════════════════════════ */
function ProfitStructureChart({ data, sym }) {
  const cs = data.costStructure;
  if (!cs || !cs.length || !cs.some(c => c && c.cogsPct != null)) return null;
  const dataLen = data.years.length;
  const COLORS = { cogs: C.chartF, opex: C.chartD, tax: C.chartE, netProfit: C.chartB, other: C.textMuted };

  if (dataLen === 1) {
    const c = cs[0];
    const pieData = [
      { name: "Cost of Goods", value: c.cogsPct || 0, fill: COLORS.cogs },
      { name: "Operating Expenses", value: c.opexPct || 0, fill: COLORS.opex },
      { name: "Taxes", value: c.taxPct || 0, fill: COLORS.tax },
      { name: "Net Profit", value: c.netProfitPct || 0, fill: COLORS.netProfit },
    ].filter(d => d.value > 0);
    if (c.otherPct > 0) pieData.push({ name: "Other", value: c.otherPct, fill: COLORS.other });
    const netProfitPct = c.netProfitPct || 0;
    let quickRead, quickColor;
    if (netProfitPct >= 20) { quickRead = `Very strong profitability — company keeps ${netProfitPct.toFixed(1)}% of every rupee as profit. Typical of premium brands or moats.`; quickColor = C.greenBg; }
    else if (netProfitPct >= 10) { quickRead = `Healthy profit margin of ${netProfitPct.toFixed(1)}%. Industry-average for most sectors.`; quickColor = C.greenBg; }
    else if (netProfitPct >= 5) { quickRead = `Modest profit margin of ${netProfitPct.toFixed(1)}%. Common in competitive or commodity industries.`; }
    else { quickRead = `Thin profit margin of ${netProfitPct.toFixed(1)}%. Company keeps very little. Check if it's industry norm or a warning.`; }

    return (
      <ChartFrame icon="🥧" title="Profit Structure" subtitle={`Where every ${sym}100 of revenue goes — costs, taxes, and what's left as profit (${data.years[0]}).`} quickRead={quickRead} quickReadColor={quickColor}>
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} label={({ value }) => `${value.toFixed(1)}%`} labelLine={false} style={{ fontSize: 11, fontWeight: 600 }}>
              {pieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
            </Pie>
            <Tooltip content={<ChartTip isPct />} />
            <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: 11.5, color: C.textSec, paddingTop: 8 }} />
          </PieChart>
        </ResponsiveContainer>
      </ChartFrame>
    );
  }

  const chartData = data.years.map((y, i) => {
    const c = cs[i] || {};
    return {
      year: String(y),
      "Cost of Goods": c.cogsPct || 0,
      "Operating Exp": c.opexPct || 0,
      "Taxes": c.taxPct || 0,
      "Net Profit": c.netProfitPct || 0,
      "Other": c.otherPct || 0,
    };
  });
  const axisStyle = { fontSize: 11, fill: C.textMuted };
  const gridStyle = { strokeDasharray: "4 4", stroke: C.border };
  const latestProfit = cs[cs.length - 1]?.netProfitPct;
  const firstProfit = cs[0]?.netProfitPct;
  let quickRead, quickColor;
  if (latestProfit != null && firstProfit != null) {
    const delta = latestProfit - firstProfit;
    if (delta > 1) { quickRead = `Net profit share grew from ${firstProfit.toFixed(1)}% to ${latestProfit.toFixed(1)}% — margin expansion. Good sign.`; quickColor = C.greenBg; }
    else if (delta < -1) { quickRead = `Net profit share shrank from ${firstProfit.toFixed(1)}% to ${latestProfit.toFixed(1)}% — margins compressing. Investigate cause.`; quickColor = C.redBg; }
    else { quickRead = `Profit share relatively stable around ${latestProfit.toFixed(1)}%. Watch cost structure for future trends.`; }
  } else { quickRead = "Green (Net Profit) slice getting bigger over time = improving efficiency. Shrinking = margin pressure."; }

  return (
    <ChartFrame icon="📊" title="Profit Structure Trend" subtitle="How every 100% of revenue splits across costs, taxes, and profit — tracked over time." quickRead={quickRead} quickReadColor={quickColor}>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid {...gridStyle} />
          <XAxis dataKey="year" tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} width={40} domain={[0, 100]} />
          <Tooltip content={<ChartTip isPct />} />
          <Legend wrapperStyle={{ fontSize: 11.5, color: C.textSec, paddingTop: 8 }} iconType="circle" />
          <Bar dataKey="Cost of Goods" stackId="a" fill={COLORS.cogs} />
          <Bar dataKey="Operating Exp" stackId="a" fill={COLORS.opex} />
          <Bar dataKey="Taxes" stackId="a" fill={COLORS.tax} />
          <Bar dataKey="Other" stackId="a" fill={COLORS.other} />
          <Bar dataKey="Net Profit" stackId="a" fill={COLORS.netProfit} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/* ═════════════════════════════════════════════════════════════
   CHART 4: EPS with Growth Badges
════════════════════════════════════════════════════════════════ */
function EPSChart({ data, sym }) {
  const hasData = data.eps?.some(v => v != null);
  if (!hasData) return null;
  const chartData = data.years.map((y, i) => ({
    year: String(y),
    EPS: data.eps?.[i],
    growth: calcGrowth(data.eps, i),
  }));
  const axisStyle = { fontSize: 11, fill: C.textMuted };
  const gridStyle = { strokeDasharray: "4 4", stroke: C.border };
  const dataLen = chartData.length;
  const latestEPS = data.eps?.[dataLen - 1];
  const firstEPS = data.eps?.[0];
  let quickRead, quickColor;
  if (dataLen === 1) {
    quickRead = `EPS of ${sym}${Number(latestEPS || 0).toFixed(2)} in ${data.years[0]}. Compare with industry peers and historical trend.`;
  } else if (firstEPS != null && latestEPS != null && firstEPS !== 0) {
    const totalGrowth = ((latestEPS - firstEPS) / Math.abs(firstEPS)) * 100;
    if (totalGrowth > 50) { quickRead = `EPS grew ${totalGrowth.toFixed(0)}% over this period — strong compounding shareholder wealth.`; quickColor = C.greenBg; }
    else if (totalGrowth > 0) { quickRead = `EPS grew ${totalGrowth.toFixed(0)}% — steady value creation. Consistency matters more than magnitude.`; quickColor = C.greenBg; }
    else if (totalGrowth > -10) { quickRead = "EPS broadly flat. Could indicate maturity or challenges — check revenue trend for context."; }
    else { quickRead = `EPS declined ${Math.abs(totalGrowth).toFixed(0)}%. Understand cause — one-off impact vs structural erosion.`; quickColor = C.redBg; }
  } else { quickRead = "Consistent EPS growth = compounding shareholder wealth. Check growth % badges between bars."; }

  return (
    <ChartFrame icon="📈" title="Earnings Per Share (EPS)" subtitle="What each share earned in profits. Consistent growth = real value creation for shareholders." quickRead={quickRead} quickReadColor={quickColor}>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 30, right: 10, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="epsGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.chartD} stopOpacity={.9}/><stop offset="100%" stopColor={C.chartD} stopOpacity={.55}/></linearGradient>
          </defs>
          <CartesianGrid {...gridStyle} />
          <XAxis dataKey="year" tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={v => `${sym}${v}`} width={50} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 16px", boxShadow: C.shadowMd }}>
                  <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 6, fontWeight: 500 }}>{label}</div>
                  <div style={{ color: C.chartD, fontSize: 13, fontFamily: "'DM Mono', monospace" }}>
                    EPS: {sym}{Number(payload[0].value).toFixed(2)}
                  </div>
                  {payload[0].payload.growth != null && (
                    <div style={{ color: payload[0].payload.growth >= 0 ? C.green : C.red, fontSize: 12, fontFamily: "'DM Mono', monospace", marginTop: 3 }}>
                      {payload[0].payload.growth >= 0 ? "↑" : "↓"} {Math.abs(payload[0].payload.growth).toFixed(1)}% YoY
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Bar dataKey="EPS" fill="url(#epsGrad)" radius={[6, 6, 0, 0]} barSize={dataLen <= 2 ? 60 : dataLen <= 4 ? 45 : 35}>
            {dataLen <= 5 && (
              <LabelList
                dataKey="EPS"
                position="top"
                content={({ x, y, width, value, index }) => {
                  const growth = chartData[index]?.growth;
                  return (
                    <g>
                      <text x={x + width / 2} y={y - 18} textAnchor="middle" style={{ fill: C.textPrimary, fontSize: 11, fontWeight: 700, fontFamily: "'DM Mono', monospace" }}>
                        {sym}{Number(value).toFixed(2)}
                      </text>
                      {growth != null && (
                        <text x={x + width / 2} y={y - 4} textAnchor="middle" style={{ fill: growth >= 0 ? C.green : C.red, fontSize: 10, fontWeight: 600 }}>
                          {growth >= 0 ? "↑" : "↓"} {Math.abs(growth).toFixed(1)}%
                        </text>
                      )}
                    </g>
                  );
                }}
              />
            )}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/* ═════════════════════════════════════════════════════════════
   ANALYSIS SECTION — NEW: Segmented 4-part analysis display
════════════════════════════════════════════════════════════════ */
function AnalysisSection({ icon, title, accentColor, paragraphs }) {
  let parts = [];
  if (Array.isArray(paragraphs)) {
    parts = paragraphs.filter(Boolean);
  } else if (typeof paragraphs === "string") {
    parts = paragraphs.split(/\n\n+/).filter(Boolean);
    if (parts.length === 0) parts = [paragraphs];
  }
  if (parts.length === 0) return null;

  return (
    <div style={{
      background: C.bgCard,
      border: `1px solid ${C.border}`,
      borderRadius: 14,
      padding: 22,
      boxShadow: C.shadow,
      transition: "all .2s",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 14,
        paddingBottom: 12,
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          background: `${accentColor}15`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          flexShrink: 0,
        }}>{icon}</div>
        <div style={{
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          fontWeight: 700,
          fontSize: 15.5,
          color: C.textPrimary,
        }}>{title}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {parts.map((para, i) => (
          <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{
              flexShrink: 0,
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: `${accentColor}15`,
              color: accentColor,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              fontWeight: 700,
              marginTop: 2,
            }}>{i + 1}</div>
            <p style={{
              color: C.textSec,
              lineHeight: 1.75,
              fontSize: 13.5,
              flex: 1,
              margin: 0,
            }}>{para}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   INSIGHT CARD — For Strengths/Risks with refined design
════════════════════════════════════════════════════════════════ */
function InsightCard({ title, items, color, icon, badgeColor }) {
  return (
    <div style={{
      background: C.bgCard,
      border: `1px solid ${C.border}`,
      borderRadius: 14,
      padding: 22,
      boxShadow: C.shadow,
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 16,
        paddingBottom: 12,
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: badgeColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 15,
          color: color,
          fontWeight: 700,
          flexShrink: 0,
        }}>{icon}</div>
        <div style={{
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          fontWeight: 700,
          fontSize: 14.5,
          color: color,
        }}>{title}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{
              flexShrink: 0,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: badgeColor,
              color: color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              fontWeight: 700,
              marginTop: 2,
            }}>{i + 1}</div>
            <div style={{
              color: C.textSec,
              fontSize: 13,
              lineHeight: 1.65,
              flex: 1,
            }}>{item}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   PERIOD DROPDOWN
════════════════════════════════════════════════════════════════ */
function PeriodDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const selected = PERIODS.find(p => p.id === value) || PERIODS[2];

  return (
    <div ref={ref} className="fs-dropdown" style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen(!open)} className="fs-dropdown-btn" style={{
        display: "flex", alignItems: "center", gap: 10, background: C.bgCard,
        border: `1.5px solid ${open ? C.accent : C.border}`, borderRadius: 14, padding: "0 16px",
        height: 52, minWidth: 150, fontSize: 14, fontWeight: 600, color: C.textPrimary,
        fontFamily: "'Plus Jakarta Sans', sans-serif", cursor: "pointer", boxShadow: C.shadow,
        transition: "border-color .15s, box-shadow .15s", whiteSpace: "nowrap",
        justifyContent: "space-between", width: "100%",
      }}>
        <span>{selected.short}</span>
        <span style={{ fontSize: 10, color: C.textMuted, transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s", marginLeft: 4 }}>▼</span>
      </button>
      {open && (
        <div className="fs-dropdown-menu" style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, width: "max(100%, 220px)",
          background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: C.shadowMd,
          zIndex: 50, overflow: "hidden", animation: "fs-dropdown-in .15s ease",
        }}>
          {PERIODS.map(p => {
            const isActive = p.id === value;
            return (
              <button key={p.id} type="button" onClick={() => { onChange(p.id); setOpen(false); }} style={{
                display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, width: "100%",
                background: isActive ? C.accentLight : "transparent", border: "none", padding: "10px 14px",
                cursor: "pointer", fontFamily: "inherit", textAlign: "left", transition: "background .12s",
              }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = C.bgSidebar; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ fontSize: 13.5, fontWeight: 600, color: isActive ? C.accent : C.textPrimary, display: "flex", alignItems: "center", gap: 6 }}>
                  {p.label}
                  {isActive && <span style={{ fontSize: 11, color: C.accent }}>✓</span>}
                </span>
                <span style={{ fontSize: 11, color: C.textMuted }}>{p.desc}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ↓↓↓ PART 1 ENDS HERE ↓↓↓
   Paste Part 2 below this line, starting with: const FONTS = `@import...
═══════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════
   ↑↑↑ PART 2 STARTS HERE ↑↑↑
   This continues where Part 1 ended — do NOT create duplicates
═══════════════════════════════════════════════════════════════ */

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');`;

const GLOBAL_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${C.bgPage}; overflow-x: hidden; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: ${C.bgPage}; }
  ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
  .fs-input:focus { outline: none; border-color: ${C.accent} !important; box-shadow: 0 0 0 3px rgba(207,107,78,.15) !important; }
  .fs-chip { transition: all .18s; }
  .fs-chip:hover { background: ${C.accentLight} !important; border-color: ${C.accent} !important; color: ${C.accent} !important; }
  .fs-btn-primary:hover { background: ${C.accentDark} !important; }
  .fs-btn-ghost:hover  { background: ${C.bgSidebar} !important; }
  .fs-card:hover { box-shadow: ${C.shadowMd} !important; border-color: ${C.borderHover} !important; }
  .fs-chart-card:hover { box-shadow: ${C.shadowMd} !important; border-color: ${C.borderHover} !important; }
  .fs-act:hover { opacity: .88 !important; transform: translateY(-1px); }
  .fs-dropdown-btn:hover { border-color: ${C.accent} !important; }
  @keyframes fs-fade { from{opacity:0;transform:translateY(12px);} to{opacity:1;transform:none;} }
  @keyframes fs-spin { to { transform: rotate(360deg); } }
  @keyframes fs-step { from{opacity:0;transform:translateX(-8px);} to{opacity:1;transform:none;} }
  @keyframes fs-dropdown-in { from{opacity:0;transform:translateY(-4px);} to{opacity:1;transform:none;} }
  .cl-internal-b3fm6y, .cl-formButtonPrimary { background-color: ${C.accent} !important; }
  .cl-formButtonPrimary:hover { background-color: ${C.accentDark} !important; }
  .cl-card { box-shadow: ${C.shadowMd} !important; border: 1px solid ${C.border} !important; }

  .fs-search-row { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 580px; }
  @media (min-width: 640px) { .fs-search-row { flex-direction: row; align-items: stretch; max-width: 740px; } }
  .fs-search-bar { flex: 1; display: flex; gap: 8px; background: ${C.bgCard}; border: 1.5px solid ${C.border}; border-radius: 14px; padding: 6px 6px 6px 14px; box-shadow: ${C.shadow}; min-height: 52px; align-items: center; }

  .fs-metrics-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  @media (min-width: 640px) { .fs-metrics-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; } }
  @media (min-width: 1024px) { .fs-metrics-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; } }

  .fs-charts-grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
  @media (min-width: 1024px) { .fs-charts-grid { grid-template-columns: 1fr 1fr; gap: 18px; } }

  .fs-analysis-sections { display: grid; grid-template-columns: 1fr; gap: 14px; margin-bottom: 20px; }
  @media (min-width: 1024px) { .fs-analysis-sections { grid-template-columns: 1fr 1fr; gap: 16px; } }

  .fs-insights-grid { display: grid; grid-template-columns: 1fr; gap: 14px; margin-bottom: 24px; }
  @media (min-width: 768px) { .fs-insights-grid { grid-template-columns: 1fr 1fr; gap: 16px; } }
  @media (min-width: 1024px) { .fs-insights-grid { grid-template-columns: 1fr 1fr 1fr; gap: 16px; } }

  .fs-header-dashboard { position: sticky; top: 0; z-index: 100; min-height: 60px; background: ${C.bgCard}; border-bottom: 1px solid ${C.border}; display: flex; align-items: center; padding: 10px 14px; gap: 10px; flex-wrap: wrap; }
  @media (min-width: 1024px) { .fs-header-dashboard { padding: 0 28px; gap: 16px; flex-wrap: nowrap; } }

  .fs-header-landing { height: auto; min-height: 56px; border-bottom: 1px solid ${C.border}; display: flex; align-items: center; padding: 10px 14px; background: ${C.bgCard}; gap: 10px; flex-wrap: wrap; }
  @media (min-width: 640px) { .fs-header-landing { padding: 0 28px; flex-wrap: nowrap; height: 56px; } }

  .fs-dash-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 1; min-width: 0; width: 100%; order: 3; }
  @media (min-width: 1024px) { .fs-dash-meta { gap: 8px; order: 0; width: auto; } }

  .fs-header-divider { display: none; }
  @media (min-width: 1024px) { .fs-header-divider { display: block; width: 1px; height: 24px; background: ${C.border}; } }

  .fs-company-name { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px; font-weight: 700; color: ${C.textPrimary}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  @media (min-width: 640px) { .fs-company-name { font-size: 15px; max-width: none; } }

  .fs-header-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }

  .fs-main-container { max-width: 1180px; margin: 0 auto; padding: 20px 14px; }
  @media (min-width: 640px) { .fs-main-container { padding: 28px 20px 22px; } }
  @media (min-width: 1024px) { .fs-main-container { padding: 32px 24px 24px; } }

  .fs-description { color: ${C.textSec}; font-size: 14px; line-height: 1.7; max-width: 680px; margin-bottom: 20px; }
  @media (min-width: 640px) { .fs-description { font-size: 14.5px; line-height: 1.75; margin-bottom: 28px; } }

  .fs-action-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-bottom: 24px; }
  .fs-action-btn { padding: 12px 20px; font-size: 14px; font-weight: 600; border-radius: 12px; font-family: 'Plus Jakarta Sans', sans-serif; cursor: pointer; display: flex; align-items: center; gap: 8px; white-space: nowrap; }
  @media (min-width: 640px) { .fs-action-btn { padding: 13px 28px; font-size: 14.5px; } }

  .fs-landing-main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 18px 28px; animation: fs-fade .6s ease both; }
  @media (min-width: 640px) { .fs-landing-main { padding: 48px 24px 32px; } }

  .fs-landing-hero { font-family: 'Plus Jakarta Sans', sans-serif; font-size: clamp(26px, 7vw, 48px); font-weight: 800; color: ${C.textPrimary}; letter-spacing: -1px; text-align: center; line-height: 1.15; margin-bottom: 14px; }

  .fs-chip-row-label { font-size: 11px; color: ${C.textMuted}; font-weight: 500; min-width: 60px; text-align: right; }
  @media (min-width: 640px) { .fs-chip-row-label { font-size: 12px; min-width: 70px; } }

  .fs-modal-bubble { max-width: 85%; }
  @media (min-width: 640px) { .fs-modal-bubble { max-width: 78%; } }

  .fs-section-heading { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 17px; color: ${C.textPrimary}; margin-bottom: 14px; display: flex; align-items: center; gap: 10px; margin-top: 8px; }
  .fs-section-heading::before { content: ''; width: 4px; height: 20px; background: ${C.accent}; border-radius: 2px; }
`;

/* ═══════════════════════════════════════════════════════════════
   LOGIN SCREEN
═══════════════════════════════════════════════════════════════ */
function LoginScreen() {
  return (
    <div style={{ minHeight: "100vh", background: C.bgPage, fontFamily: "'DM Sans', system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{FONTS + GLOBAL_CSS}</style>

      <div style={{ marginBottom: 24, textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 16 }}>
          <FinSightLogo size={56} />
          <div style={{ textAlign: "left" }}>
            <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 28, color: C.textPrimary, letterSpacing: "-.8px", lineHeight: 1 }}>FinSight AI</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>by <span style={{ color: C.accent, fontWeight: 600 }}>Pallav Shah</span></div>
          </div>
        </div>
        <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 20, color: C.textPrimary, marginBottom: 6, padding: "0 10px" }}>Welcome to financial intelligence</h2>
        <p style={{ color: C.textSec, fontSize: 14, padding: "0 10px" }}>Sign in to analyze any company's financials</p>
      </div>

      <SignIn
        appearance={{
          elements: {
            rootBox: { width: "100%", maxWidth: 400 },
            card: { background: C.bgCard, border: `1px solid ${C.border}`, boxShadow: C.shadow },
            formButtonPrimary: { background: C.accent, "&:hover": { background: C.accentDark } },
          }
        }}
      />

      <div style={{ marginTop: 24, color: C.textMuted, fontSize: 12, textAlign: "center", padding: "0 20px" }}>
        By continuing, you agree to our Terms & Privacy Policy
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════════════════ */
function FinSightApp() {
  const { user } = useUser();
  const [screen, setScreen]         = useState("landing");
  const [q, setQ]                   = useState("");
  const [period, setPeriod]         = useState(DEFAULT_PERIOD);
  const [data, setData]             = useState(null);
  const [err, setErr]               = useState("");
  const [stepIdx, setStepIdx]       = useState(0);
  const [modal, setModal]           = useState(null);
  const [scriptText, setScriptText] = useState("");
  const [scriptLoading, setScriptLoading] = useState(false);

  useEffect(() => {
    if (user) {
      fetch("/api/track-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          email: user.primaryEmailAddress?.emailAddress,
          phone: user.primaryPhoneNumber?.phoneNumber,
          name: user.fullName,
          firstName: user.firstName,
          lastName: user.lastName,
          signedUpAt: user.createdAt,
          provider: user.externalAccounts?.[0]?.provider || "email",
        })
      }).catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    if (screen !== "loading") return;
    setStepIdx(0);
    const t = setInterval(() => setStepIdx(i => Math.min(i + 1, STEPS.length - 1)), 2800);
    return () => clearInterval(t);
  }, [screen]);

  const analyze = async (company) => {
    setScreen("loading"); setErr(""); setScriptText(""); setModal(null);

    if (user) {
      fetch("/api/track-activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          email: user.primaryEmailAddress?.emailAddress,
          action: "analyze",
          company, period,
          timestamp: new Date().toISOString(),
        })
      }).catch(() => {});
    }

    const periodLabel = PERIODS.find(p => p.id === period)?.label || "1 Year";

    try {
      const raw = await callClaude({
        system: buildSystemPrompt(period),
        userMsg: `Find and analyze the LATEST available financial data for: ${company}. Analysis period requested: ${periodLabel} (${period}). Use web search to retrieve real, recent numbers (target Q3/Q4 FY26 or latest available). Include cost structure and EPS. Provide analysis in 4 segmented sections (analysisRevenue, analysisProfitability, analysisCashFlow, analysisOutlook), each with 3 paragraphs of 2-3 sentences. Return ONLY JSON matching the schema provided.`,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        maxTokens: 6000,
      });
      let json = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      const s = json.indexOf("{"), e = json.lastIndexOf("}");
      if (s >= 0 && e >= 0) json = json.slice(s, e + 1);
      setData(JSON.parse(json));
      setScreen("dashboard");
    } catch (ex) {
      setErr(ex.message || "Analysis failed. Please try again.");
      setScreen("error");
    }
  };

  const genScript = async () => {
    setModal("script"); setScriptLoading(true); setScriptText("");
    try {
      const d = data, sym = d.currencySymbol;
      const revStr = d.years.map((y, i) => `${y}: ${sym}${(d.revenue[i] / 1000).toFixed(1)}B`).join(", ");
      const niStr  = d.years.map((y, i) => `${y}: ${sym}${(d.netIncome[i] / 1000).toFixed(1)}B`).join(", ");
      const text = await callClaude({
        system: "You write engaging financial podcast scripts. Use real numbers. Be conversational but insightful.",
        userMsg: `Write a 5-minute podcast between hosts ALEX and PRIYA analyzing ${d.company} (${d.ticker}). Revenue: ${revStr}. Net Income: ${niStr}. CAGR: ${d.revenueCAGR}%. Outlook: ${d.outlook} — ${d.outlookReason}. Strengths: ${d.keyStrengths.join("; ")}. Risks: ${d.keyRisks.join("; ")}. Format strictly as alternating ALEX: and PRIYA: turns, 2–3 sentences each.`,
        maxTokens: 1800,
      });
      setScriptText(text);
    } catch { setScriptText("Failed to generate script. Please try again."); }
    setScriptLoading(false);
  };

  const openGamma = () => {
    const d = data, sym = d.currencySymbol;
    const periodLabel = PERIODS.find(p => p.id === (d.periodType || period))?.label || "1 Year";
    const prompt = `Create a professional 8-slide financial analysis presentation for ${d.company} (${d.ticker}, ${d.exchange}). Analysis period: ${periodLabel}. Revenue: ${d.years.map((y, i) => `${y}: ${sym}${(d.revenue[i] / 1000).toFixed(1)}B`).join(", ")}. Net Income: ${d.years.map((y, i) => `${y}: ${sym}${(d.netIncome[i] / 1000).toFixed(1)}B`).join(", ")}. CAGR: ${d.revenueCAGR}%. Market Cap: ${sym}${(d.marketCap/1000).toFixed(1)}B. P/E: ${d.peRatio}x. Sector: ${d.sector}. Outlook: ${d.outlook}. Strengths: ${d.keyStrengths.join(", ")}. Risks: ${d.keyRisks.join(", ")}. Slides: 1) Company Overview 2) Revenue Journey 3) Profitability 4) Cash Flow 5) Key Metrics 6) Strengths & Risks 7) Outlook 8) Summary`;
    navigator.clipboard.writeText(prompt);
    window.open("https://gamma.app/create/generate", "_blank");
    setModal("ppt");
  };

  if (screen === "landing") return (
    <div style={{ minHeight: "100vh", background: C.bgPage, fontFamily: "'DM Sans', system-ui, sans-serif", display: "flex", flexDirection: "column" }}>
      <style>{FONTS + GLOBAL_CSS}</style>

      <header className="fs-header-landing">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <FinSightLogo size={28} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 15, color: C.textPrimary, letterSpacing: "-.3px", lineHeight: 1 }}>FinSight AI</span>
            <span style={{ fontSize: 9.5, color: C.textMuted, letterSpacing: ".4px", marginTop: 2 }}>by <span style={{ color: C.accent, fontWeight: 600 }}>Pallav Shah</span></span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <UserButton afterSignOutUrl="/" />
        </div>
      </header>

      <main className="fs-landing-main">
        <div style={{ marginBottom: 24 }}><FinSightLogo size={64} /></div>

        <h1 className="fs-landing-hero">
          Financial intelligence,<br />
          <span style={{ color: C.accent }}>one company at a time.</span>
        </h1>

        <p style={{ color: C.textSec, fontSize: 15, lineHeight: 1.7, textAlign: "center", maxWidth: 540, marginBottom: 32, padding: "0 8px" }}>
          Type any company name. Get AI-powered financial analysis with interactive charts, PPT deck, and podcast script.
        </p>

        <div className="fs-search-row" style={{ marginBottom: 32 }}>
          <PeriodDropdown value={period} onChange={setPeriod} />

          <div className="fs-search-bar">
            <input
              className="fs-input"
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === "Enter" && q.trim() && analyze(q.trim())}
              placeholder="e.g. Apple, Reliance, Tesla..."
              style={{ flex: 1, background: "none", border: "none", outline: "none", color: C.textPrimary, fontSize: 15, fontFamily: "inherit", minWidth: 0 }}
            />
            <button
              className="fs-btn-primary"
              onClick={() => q.trim() && analyze(q.trim())}
              disabled={!q.trim()}
              style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontSize: 14, fontWeight: 600, fontFamily: "'Plus Jakarta Sans', sans-serif", cursor: "pointer", whiteSpace: "nowrap", opacity: q.trim() ? 1 : .55 }}
            >
              Analyze →
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", marginBottom: 40, width: "100%" }}>
          {[{ flag: "🇺🇸", label: "US", items: US_EX }, { flag: "🇮🇳", label: "India", items: IN_EX }].map(row => (
            <div key={row.flag} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "center", maxWidth: "100%" }}>
              <span className="fs-chip-row-label">{row.flag} {row.label}</span>
              {row.items.map(c => (
                <button key={c} className="fs-chip" onClick={() => analyze(c)} style={{ background: C.bgCard, border: `1px solid ${C.border}`, color: C.textSec, borderRadius: 20, padding: "5px 12px", fontSize: 12.5, fontFamily: "inherit", cursor: "pointer" }}>{c}</button>
              ))}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", justifyContent: "center", padding: "0 16px" }}>
          {[
            { icon: "📈", text: "Flexible Periods" },
            { icon: "📊", text: "Auto PPT via Gamma" },
            { icon: "🎙️", text: "AI Podcast Script" },
            { icon: "🌍", text: "US + India Markets" },
          ].map(f => (
            <div key={f.text} style={{ display: "flex", alignItems: "center", gap: 6, color: C.textSec, fontSize: 12.5 }}>
              <span style={{ fontSize: 14 }}>{f.icon}</span>
              <span>{f.text}</span>
            </div>
          ))}
        </div>
      </main>

      <footer style={{ padding: "18px 20px", textAlign: "center", borderTop: `1px solid ${C.border}`, background: C.bgCard }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ color: C.textMuted, fontSize: 11.5 }}>FinSight AI · Research & education only · Not investment advice</span>
          <span style={{ color: C.border }}>·</span>
          <Byline />
        </div>
      </footer>
    </div>
  );

  if (screen === "loading") return (
    <div style={{ minHeight: "100vh", background: C.bgPage, fontFamily: "'DM Sans', system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{FONTS + GLOBAL_CSS}</style>
      <div style={{ marginBottom: 24 }}><FinSightLogo size={52} /></div>
      <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 20, fontWeight: 700, color: C.textPrimary, marginBottom: 6, textAlign: "center" }}>Analyzing financials…</h2>
      <p style={{ color: C.textSec, fontSize: 13.5, marginBottom: 36, textAlign: "center", padding: "0 20px" }}>
        Period: {PERIODS.find(p => p.id === period)?.label} · Searching live data — takes about 20–30 seconds
      </p>
      <div style={{ width: "100%", maxWidth: 320, padding: "0 16px" }}>
        {STEPS.map((s, i) => {
          const done = i < stepIdx, active = i === stepIdx, pending = i > stepIdx;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, opacity: pending ? .32 : 1, transition: "opacity .4s", animation: active ? "fs-step .3s ease" : "none" }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: done ? C.green : active ? C.accent : C.border }}>
                {done ? <span style={{ color: "#fff", fontSize: 12 }}>✓</span> : active ? <Spinner /> : null}
              </div>
              <span style={{ fontSize: 13.5, color: done ? C.green : active ? C.accent : C.textMuted, fontWeight: active ? 600 : 400 }}>{s}</span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 40 }}><Byline /></div>
    </div>
  );

  if (screen === "error") return (
    <div style={{ minHeight: "100vh", background: C.bgPage, fontFamily: "'DM Sans', system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20, textAlign: "center" }}>
      <style>{FONTS + GLOBAL_CSS}</style>
      <div style={{ width: 56, height: 56, borderRadius: 16, background: C.redBg, border: `1px solid ${C.red}33`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, marginBottom: 18 }}>⚠️</div>
      <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 19, fontWeight: 700, color: C.red, marginBottom: 10 }}>Analysis failed</h2>
      <p style={{ color: C.textSec, maxWidth: 440, lineHeight: 1.7, marginBottom: 24, fontSize: 14 }}>{err}</p>
      <button onClick={() => setScreen("landing")} style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 10, padding: "11px 26px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>← Try again</button>
    </div>
  );

  if (screen === "dashboard" && data) {
    const sym = data.currencySymbol || "$";
    const OUTLOOK = {
      Positive: { color: C.green, bg: C.greenBg },
      Mixed:    { color: C.amber, bg: C.amberBg },
      Caution:  { color: C.red, bg: C.redBg },
      Bullish:  { color: C.green, bg: C.greenBg },
      Neutral:  { color: C.amber, bg: C.amberBg },
      Bearish:  { color: C.red, bg: C.redBg },
    };
    const oc = OUTLOOK[data.outlook] || OUTLOOK.Mixed;
    const lastIdx = (data.years?.length || 1) - 1;
    const latestRev = data.revenue?.[lastIdx], latestNI = data.netIncome?.[lastIdx];
    const latestFCF = data.freeCashFlow?.[lastIdx], latestNM = data.netMargin?.[lastIdx];
    const latestLabel = data.years?.[lastIdx] || "Latest";
    const periodLabel = PERIODS.find(p => p.id === data.periodType)?.label || "Analysis";

    // Fallback: if old 'analysis' field exists but not the 4 new ones, split it
    const analysisRev = data.analysisRevenue || (data.analysis ? [data.analysis] : null);
    const analysisProf = data.analysisProfitability || null;
    const analysisCash = data.analysisCashFlow || null;
    const analysisOut = data.analysisOutlook || null;

    return (
      <div style={{ minHeight: "100vh", background: C.bgPage, color: C.textPrimary, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
        <style>{FONTS + GLOBAL_CSS}</style>

        <header className="fs-header-dashboard">
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <FinSightLogo size={24} />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 13, color: C.textPrimary, lineHeight: 1 }}>FinSight AI</span>
              <span style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>by <span style={{ color: C.accent, fontWeight: 600 }}>Pallav Shah</span></span>
            </div>
          </div>

          <div className="fs-header-divider" />

          <div className="fs-dash-meta">
            <span className="fs-company-name">{data.company}</span>
            <span style={{ background: C.bgSidebar, color: C.textSec, fontSize: 10.5, fontFamily: "'DM Mono', monospace", padding: "2px 7px", borderRadius: 5, border: `1px solid ${C.border}` }}>{data.ticker}</span>
            <span style={{ background: C.bgSidebar, color: C.textMuted, fontSize: 10.5, padding: "2px 7px", borderRadius: 5, border: `1px solid ${C.border}` }}>{data.exchange}</span>
            <span style={{ background: C.accentLight, color: C.accent, fontSize: 10.5, fontWeight: 600, padding: "2px 9px", borderRadius: 5 }}>{periodLabel}</span>
            <span style={{ background: oc.bg, color: oc.color, fontSize: 10.5, fontWeight: 600, padding: "2px 9px", borderRadius: 5 }}>{data.outlook}</span>
          </div>

          <div className="fs-header-actions">
            <button onClick={() => setScreen("landing")} style={{ background: "none", border: `1px solid ${C.border}`, color: C.textSec, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap", fontFamily: "inherit" }}>← New</button>
            <UserButton afterSignOutUrl="/" />
          </div>
        </header>

        <div className="fs-main-container">
          <p className="fs-description">{data.description}</p>

          {data.dataAsOf && (
            <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 14 }}>
              📅 Data as of: <strong style={{ color: C.textSec }}>{data.dataAsOf}</strong> · Period: <strong style={{ color: C.accent }}>{periodLabel}</strong>
            </div>
          )}

          <div className="fs-metrics-grid" style={{ marginBottom: 24 }}>
            {[
              { label: `${latestLabel} Revenue`,    value: fmtMoney(latestRev, sym), sub: data.revenueCAGR ? `CAGR ${Number(data.revenueCAGR).toFixed(1)}%` : "Latest" },
              { label: `${latestLabel} Net Income`, value: fmtMoney(latestNI,  sym), sub: latestNM ? `Margin ${Number(latestNM).toFixed(1)}%` : "Latest" },
              { label: "Market Cap",                value: fmtMoney(data.marketCap, sym), sub: data.exchange },
              { label: "P/E Ratio",                 value: data.peRatio ? `${Number(data.peRatio).toFixed(1)}×` : "N/A", sub: "Current" },
              { label: "Free Cash Flow",            value: fmtMoney(latestFCF, sym), sub: latestLabel },
              { label: "Revenue Growth",            value: data.revenueCAGR ? `${Number(data.revenueCAGR).toFixed(1)}%` : "N/A", sub: periodLabel, accent: C.accent },
            ].map(m => <MetricCard key={m.label} {...m} />)}
          </div>

          {/* ═══ 4 ANALYTICAL CHARTS ═══ */}
          <div className="fs-section-heading">Financial Analysis</div>
          <div className="fs-charts-grid" style={{ marginBottom: 24 }}>
            <GrowthQualityChart data={data} sym={sym} />
            <CashQualityChart data={data} sym={sym} />
            <ProfitStructureChart data={data} sym={sym} />
            <EPSChart data={data} sym={sym} />
          </div>

          {/* ═══ SEGMENTED AI ANALYSIS (4 SECTIONS) ═══ */}
          <div className="fs-section-heading">AI Financial Analysis</div>
          <div className="fs-analysis-sections">
            {analysisRev && (
              <AnalysisSection
                icon="📈"
                title="Revenue & Growth Story"
                accentColor={C.chartA}
                paragraphs={analysisRev}
              />
            )}
            {analysisProf && (
              <AnalysisSection
                icon="💰"
                title="Profitability Performance"
                accentColor={C.chartB}
                paragraphs={analysisProf}
              />
            )}
            {analysisCash && (
              <AnalysisSection
                icon="💵"
                title="Cash Flow Analysis"
                accentColor={C.chartC}
                paragraphs={analysisCash}
              />
            )}
            {analysisOut && (
              <AnalysisSection
                icon="🎯"
                title="Competitive & Strategic Outlook"
                accentColor={C.chartD}
                paragraphs={analysisOut}
              />
            )}
          </div>

          {/* ═══ KEY STRENGTHS / KEY RISKS / OUTLOOK ═══ */}
          <div className="fs-section-heading">Key Insights</div>
          <div className="fs-insights-grid">
            <InsightCard
              title="Key Strengths"
              icon="✓"
              color={C.green}
              badgeColor={C.greenBg}
              items={data.keyStrengths || []}
            />
            <InsightCard
              title="Key Risks"
              icon="⚠"
              color={C.red}
              badgeColor={C.redBg}
              items={data.keyRisks || []}
            />
            <div style={{ background: oc.bg, border: `1px solid ${oc.color}33`, borderRadius: 14, padding: 22, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${oc.color}22` }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: oc.color + "20", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: oc.color, fontWeight: 700 }}>◎</div>
                <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 14.5, color: oc.color }}>{data.outlook} Outlook</div>
              </div>
              <div style={{ color: C.textSec, fontSize: 13, lineHeight: 1.7 }}>{data.outlookReason}</div>
            </div>
          </div>

          <div className="fs-action-row">
            <button className="fs-act fs-action-btn" onClick={openGamma} style={{ background: C.accent, color: "#fff", border: "none" }}>📊 Generate PPT</button>
            <button className="fs-act fs-action-btn" onClick={genScript} style={{ background: C.bgCard, color: C.textPrimary, border: `1px solid ${C.border}` }}>🎙️ Podcast Script</button>
            <button className="fs-act fs-action-btn" onClick={() => setScreen("landing")} style={{ background: "transparent", color: C.textSec, border: `1px solid ${C.border}` }}>← New search</button>
          </div>

          <div style={{ background: C.bgSidebar, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 11.5, color: C.textMuted, lineHeight: 1.6 }}>
            <strong style={{ color: C.textSec }}>Disclaimer:</strong> FinSight AI provides research and educational content only. This is not investment advice. We are not a SEBI-registered Investment Advisor. Verify information with original sources and consult a qualified financial advisor before making any investment decisions.
          </div>

          <div style={{ textAlign: "center", paddingTop: 20, borderTop: `1px solid ${C.border}` }}><Byline /></div>
        </div>

        {modal === "script" && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(31,27,24,.5)", backdropFilter: "blur(4px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 18, width: "100%", maxWidth: 720, maxHeight: "82vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(31,27,24,.3)" }}>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: C.bgSidebar, gap: 10 }}>
                <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🎙️ Podcast — {data.company}</div>
                <button onClick={() => setModal(null)} style={{ background: "none", border: "none", color: C.textMuted, fontSize: 22, cursor: "pointer", padding: 4, flexShrink: 0 }}>✕</button>
              </div>
              <div style={{ overflowY: "auto", flex: 1, padding: 20 }}>
                {scriptLoading ? (
                  <div style={{ textAlign: "center", padding: 50, color: C.textSec, fontSize: 14, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                    <Spinner />Generating your podcast script... ~15 seconds
                  </div>
                ) : (
                  scriptText.split("\n").filter(Boolean).map((line, i) => {
                    const isA = line.startsWith("ALEX:");
                    const isP = line.startsWith("PRIYA:");
                    if (!isA && !isP) return <div key={i} style={{ color: C.textMuted, fontSize: 12, fontStyle: "italic", textAlign: "center", margin: "10px 0" }}>{line}</div>;
                    return (
                      <div key={i} style={{ display: "flex", gap: 10, marginBottom: 14, flexDirection: isA ? "row" : "row-reverse" }}>
                        <div style={{ width: 32, height: 32, borderRadius: "50%", background: isA ? C.accentLight : C.blueBg, color: isA ? C.accent : C.chartC, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
                          {isA ? "A" : "P"}
                        </div>
                        <div className="fs-modal-bubble" style={{ background: isA ? C.bgSidebar : C.blueBg, borderRadius: isA ? "4px 14px 14px 14px" : "14px 4px 14px 14px", padding: "10px 14px", color: C.textPrimary, fontSize: 13.5, lineHeight: 1.65 }}>
                          <div style={{ color: isA ? C.accent : C.chartC, fontSize: 10, fontWeight: 700, letterSpacing: ".8px", marginBottom: 4 }}>{isA ? "ALEX" : "PRIYA"}</div>
                          {line.replace(/^(ALEX|PRIYA):\s*/, "")}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {modal === "ppt" && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(31,27,24,.5)", backdropFilter: "blur(4px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 18, padding: "32px 26px", maxWidth: 460, width: "100%", textAlign: "center", boxShadow: "0 20px 60px rgba(31,27,24,.3)" }}>
              <div style={{ width: 60, height: 60, borderRadius: 18, background: C.greenBg, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 26, marginBottom: 18 }}>✓</div>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 19, fontWeight: 700, color: C.textPrimary, marginBottom: 10 }}>Prompt copied!</div>
              <div style={{ color: C.textSec, fontSize: 13.5, marginBottom: 8, lineHeight: 1.7 }}>Gamma has opened in a new tab.</div>
              <div style={{ color: C.textSec, fontSize: 13.5, marginBottom: 22, lineHeight: 1.7 }}>Just <strong style={{ color: C.textPrimary }}>paste (⌘V / Ctrl+V)</strong> into Gamma's prompt box and click <strong>Generate</strong>.</div>
              <button onClick={() => setModal(null)} style={{ background: "none", border: `1px solid ${C.border}`, color: C.textSec, borderRadius: 8, padding: "10px 26px", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>Close</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}

/* ═══════════════════════════════════════════════════════════════
   ROOT COMPONENT
═══════════════════════════════════════════════════════════════ */
export default function App() {
  if (!CLERK_PUB_KEY) {
    return (
      <div style={{ padding: 40, textAlign: "center", fontFamily: "sans-serif" }}>
        <h2 style={{ color: "#C04040" }}>⚠️ Clerk Key Missing</h2>
        <p>Please add VITE_CLERK_PUBLISHABLE_KEY to your Vercel environment variables.</p>
      </div>
    );
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUB_KEY}>
      <SignedOut>
        <LoginScreen />
      </SignedOut>
      <SignedIn>
        <FinSightApp />
      </SignedIn>
    </ClerkProvider>
  );
}
