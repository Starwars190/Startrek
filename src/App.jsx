import { useState, useEffect } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { ClerkProvider, SignedIn, SignedOut, SignIn, SignUp, UserButton, useUser } from "@clerk/clerk-react";

/* ═════════════════════════════════════════════════════════════
   FinSight AI — by Pallav Shah
   WITH LOGIN — Clerk authentication + user tracking
   MOBILE RESPONSIVE — v3 (April 22, 2026)
   NEW: Period selector (6 options) + updated system prompt
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
  shadow:      "0 1px 3px rgba(0,0,0,.05), 0 2px 8px rgba(0,0,0,.03)",
  shadowMd:    "0 2px 12px rgba(0,0,0,.08), 0 1px 4px rgba(0,0,0,.04)",
};

const API_URL = "/api/claude";
const MODEL   = "claude-sonnet-4-5";

/* ═════════════════════════════════════════════════════════════
   PERIOD OPTIONS — NEW (April 22, 2026)
════════════════════════════════════════════════════════════════ */
const PERIODS = [
  { id: "latest_quarter", label: "Latest Quarter", short: "Q",   desc: "Most recent quarter" },
  { id: "half_yearly",    label: "Half Yearly",    short: "H1",  desc: "Last 2 quarters" },
  { id: "1_year",         label: "1 Year",         short: "1Y",  desc: "Full fiscal year" },
  { id: "2_year",         label: "2 Years",        short: "2Y",  desc: "YoY comparison" },
  { id: "3_year",         label: "3 Years",        short: "3Y",  desc: "Medium-term trend" },
  { id: "5_year",         label: "5 Years",        short: "5Y",  desc: "Long-term history" },
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

const ChartTip = ({ active, payload, label, sym = "$", isPct = false }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 16px", boxShadow: C.shadowMd }}>
      <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 6, fontWeight: 500 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, fontSize: 13, fontFamily: "'DM Mono', monospace" }}>
          {p.name}: {isPct ? `${Number(p.value).toFixed(1)}%` : fmtMoney(p.value, sym)}
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
   SYSTEM PROMPT v3 — UPDATED April 22, 2026
   - Targets latest available data (Q3/Q4 FY26)
   - Dynamic period handling
   - Explicit current date context
════════════════════════════════════════════════════════════════ */
function buildSystemPrompt(period) {
  const today = new Date().toISOString().split('T')[0];
  const currentYear = new Date().getFullYear();
  const prevYear = currentYear - 1;
  const startYear = currentYear - 5;

  const periodInstructions = {
    latest_quarter: `Return data for the MOST RECENT QUARTER only (target Q3 FY26 or Q4 FY26 if available).
- "years" array: Use quarter labels like ["Q3 FY26"] — just 1 entry
- All financial arrays: 1 value each (the latest quarter)`,
    half_yearly: `Return data for the LAST 2 QUARTERS.
- "years" array: Quarter labels like ["Q2 FY26", "Q3 FY26"] — 2 entries
- All financial arrays: 2 values each`,
    "1_year": `Return data for the LAST 4 QUARTERS (full fiscal year).
- "years" array: Quarter labels like ["Q4 FY25", "Q1 FY26", "Q2 FY26", "Q3 FY26"] — 4 entries
- All financial arrays: 4 values each`,
    "2_year": `Return data for the LAST 2 FISCAL YEARS.
- "years" array: ["FY25", "FY26"] — 2 entries (use most recent completed fiscal years)
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
- NEVER return data older than 6 months as "current" without disclosure

ANALYSIS PERIOD REQUESTED: ${period.toUpperCase()}
${periodInstructions[period] || periodInstructions["1_year"]}

RESEARCH APPROACH:
1. Perform web searches for latest data from these priority sources:
   - Company IR pages (annual/quarterly reports)
   - BSE/NSE filings (Indian companies)
   - SEC filings (US companies)
   - Earnings call transcripts
   - Recent news (last 3 months)
2. Prioritize OFFICIAL filings over secondary sources
3. If latest period data is unavailable, explicitly note "Data as of [period]"

OUTPUT: Return ONLY raw JSON. No markdown, no backticks — only the JSON object.

Return this exact structure (monetary values in MILLIONS of local currency):
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
  "dataAsOf": "YYYY-MM-DD (latest data date)",
  "years": [label, label, ...],
  "revenue": [n, n, ...],
  "netIncome": [n, n, ...],
  "ebitda": [n, n, ...],
  "freeCashFlow": [n, n, ...],
  "grossMargin": [n, n, ...],
  "netMargin": [n, n, ...],
  "eps": [n, n, ...],
  "marketCap": number,
  "peRatio": number,
  "revenueCAGR": number,
  "analysis": "3-4 paragraphs with specific numbers: revenue trend, profitability, cash flow, competitive outlook",
  "keyStrengths": ["strength with data", "strength with data", "strength with data"],
  "keyRisks": ["risk with context", "risk with context", "risk with context"],
  "outlook": "Positive or Mixed or Caution",
  "outlookReason": "One concise sentence"
}

IMPORTANT NOTES ON ARRAYS:
- ALL financial arrays (revenue, netIncome, ebitda, freeCashFlow, grossMargin, netMargin, eps) MUST have the SAME NUMBER of entries as the "years" array
- If a metric is unavailable for some periods, use null (not 0)
- revenueCAGR: Only meaningful for 2+ year periods; return 0 for shorter periods`;
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
  .fs-act:hover { opacity: .88 !important; transform: translateY(-1px); }
  .fs-period-btn { transition: all .18s; }
  .fs-period-btn:hover { background: ${C.accentLight} !important; border-color: ${C.accent} !important; color: ${C.accent} !important; }
  .fs-period-btn.active { background: ${C.accent} !important; color: #fff !important; border-color: ${C.accent} !important; }
  @keyframes fs-fade { from{opacity:0;transform:translateY(12px);} to{opacity:1;transform:none;} }
  @keyframes fs-spin { to { transform: rotate(360deg); } }
  @keyframes fs-step { from{opacity:0;transform:translateX(-8px);} to{opacity:1;transform:none;} }
  .cl-internal-b3fm6y, .cl-formButtonPrimary { background-color: ${C.accent} !important; }
  .cl-formButtonPrimary:hover { background-color: ${C.accentDark} !important; }
  .cl-card { box-shadow: ${C.shadowMd} !important; border: 1px solid ${C.border} !important; }

  /* RESPONSIVE GRIDS — Mobile First */
  .fs-metrics-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  @media (min-width: 640px) { .fs-metrics-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; } }
  @media (min-width: 1024px) { .fs-metrics-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; } }

  .fs-charts-grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
  @media (min-width: 1024px) { .fs-charts-grid { grid-template-columns: 1fr 1fr; gap: 16px; } }

  .fs-analysis-grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
  @media (min-width: 1024px) { .fs-analysis-grid { grid-template-columns: 3fr 2fr; gap: 16px; } }

  /* PERIOD SELECTOR — NEW */
  .fs-period-row { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-bottom: 16px; padding: 0 8px; }
  .fs-period-btn { background: ${C.bgCard}; border: 1px solid ${C.border}; color: ${C.textSec}; border-radius: 20px; padding: 6px 12px; font-size: 12.5px; font-weight: 500; cursor: pointer; font-family: inherit; white-space: nowrap; }
  @media (min-width: 640px) { .fs-period-btn { padding: 7px 14px; font-size: 13px; } }

  /* RESPONSIVE HEADERS */
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

  /* RESPONSIVE PADDING */
  .fs-main-container { max-width: 1180px; margin: 0 auto; padding: 20px 14px; }
  @media (min-width: 640px) { .fs-main-container { padding: 28px 20px 22px; } }
  @media (min-width: 1024px) { .fs-main-container { padding: 32px 24px 24px; } }

  .fs-description { color: ${C.textSec}; font-size: 14px; line-height: 1.7; max-width: 680px; margin-bottom: 20px; }
  @media (min-width: 640px) { .fs-description { font-size: 14.5px; line-height: 1.75; margin-bottom: 28px; } }

  .fs-chart-card { background: ${C.bgCard}; border: 1px solid ${C.border}; border-radius: 14px; padding: 16px; box-shadow: ${C.shadow}; }
  @media (min-width: 640px) { .fs-chart-card { padding: 20px; } }
  @media (min-width: 1024px) { .fs-chart-card { padding: 24px; } }

  .fs-analysis-card { background: ${C.bgCard}; border: 1px solid ${C.border}; border-radius: 14px; padding: 20px; box-shadow: ${C.shadow}; }
  @media (min-width: 1024px) { .fs-analysis-card { padding: 28px; } }

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
`;

/* ═══════════════════════════════════════════════════════════════
   LOGIN SCREEN — shown to logged-out users
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
   MAIN APP — shown to logged-in users
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
          company,
          period,
          timestamp: new Date().toISOString(),
        })
      }).catch(() => {});
    }

    const periodLabel = PERIODS.find(p => p.id === period)?.label || "1 Year";

    try {
      const raw = await callClaude({
        system: buildSystemPrompt(period),
        userMsg: `Find and analyze the LATEST available financial data for: ${company}. Analysis period requested: ${periodLabel} (${period}). Use web search to retrieve real, recent numbers (target Q3/Q4 FY26 or latest available). Return ONLY JSON matching the schema provided.`,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
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

  const cData = data ? data.years.map((y, i) => ({
    year: String(y),
    Revenue: data.revenue?.[i],
    "Net Income": data.netIncome?.[i],
    EBITDA: data.ebitda?.[i],
    FCF: data.freeCashFlow?.[i],
    "Gross Margin": data.grossMargin?.[i],
    "Net Margin": data.netMargin?.[i],
  })) : [];

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

        <div style={{ width: "100%", maxWidth: 580, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, background: C.bgCard, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: "6px 6px 6px 14px", boxShadow: C.shadow }}>
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

        {/* NEW: Period Selector */}
        <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 500, letterSpacing: ".5px", textTransform: "uppercase", marginBottom: 8 }}>
          Analysis Period
        </div>
        <div className="fs-period-row">
          {PERIODS.map(p => (
            <button
              key={p.id}
              className={`fs-period-btn ${period === p.id ? 'active' : ''}`}
              onClick={() => setPeriod(p.id)}
              title={p.desc}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", marginBottom: 40, marginTop: 24, width: "100%" }}>
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
      // Legacy support
      Bullish: { color: C.green, bg: C.greenBg },
      Neutral: { color: C.amber, bg: C.amberBg },
      Bearish: { color: C.red, bg: C.redBg },
    };
    const oc = OUTLOOK[data.outlook] || OUTLOOK.Mixed;
    const lastIdx = (data.years?.length || 1) - 1;
    const latestRev = data.revenue?.[lastIdx], latestNI = data.netIncome?.[lastIdx];
    const latestFCF = data.freeCashFlow?.[lastIdx], latestNM = data.netMargin?.[lastIdx];
    const latestLabel = data.years?.[lastIdx] || "Latest";
    const periodLabel = PERIODS.find(p => p.id === data.periodType)?.label || "Analysis";
    const axisStyle = { fontSize: 10.5, fill: C.textMuted };
    const gridStyle = { strokeDasharray: "4 4", stroke: C.border };

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

          <div className="fs-charts-grid" style={{ marginBottom: 20 }}>
            <div className="fs-chart-card">
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 3 }}>Revenue & Net Income</div>
              <div style={{ color: C.textMuted, fontSize: 11.5, marginBottom: 14 }}>{periodLabel} · {data.currency} millions</div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={cData}>
                  <defs>
                    <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.chartA} stopOpacity={.22}/><stop offset="100%" stopColor={C.chartA} stopOpacity={0}/></linearGradient>
                    <linearGradient id="gB" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.chartB} stopOpacity={.22}/><stop offset="100%" stopColor={C.chartB} stopOpacity={0}/></linearGradient>
                  </defs>
                  <CartesianGrid {...gridStyle} />
                  <XAxis dataKey="year" tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={v => fmtMoney(v, "")} width={40} />
                  <Tooltip content={<ChartTip sym={sym} />} />
                  <Legend wrapperStyle={{ fontSize: 11.5, color: C.textSec }} />
                  <Area type="monotone" dataKey="Revenue"    stroke={C.chartA} fill="url(#gA)" strokeWidth={2.2} dot={{ fill: C.chartA, r: 3, strokeWidth: 0 }} />
                  <Area type="monotone" dataKey="Net Income" stroke={C.chartB} fill="url(#gB)" strokeWidth={2.2} dot={{ fill: C.chartB, r: 3, strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="fs-chart-card">
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 3 }}>Profit Margins</div>
              <div style={{ color: C.textMuted, fontSize: 11.5, marginBottom: 14 }}>Gross & Net margin trends · %</div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={cData}>
                  <CartesianGrid {...gridStyle} />
                  <XAxis dataKey="year" tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} width={35} />
                  <Tooltip content={<ChartTip isPct />} />
                  <Legend wrapperStyle={{ fontSize: 11.5, color: C.textSec }} />
                  <Line type="monotone" dataKey="Gross Margin" stroke={C.chartC} strokeWidth={2.4} dot={{ fill: C.chartC, r: 4, strokeWidth: 0 }} />
                  <Line type="monotone" dataKey="Net Margin"   stroke={C.chartD} strokeWidth={2.4} dot={{ fill: C.chartD, r: 4, strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="fs-chart-card">
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 3 }}>EBITDA</div>
              <div style={{ color: C.textMuted, fontSize: 11.5, marginBottom: 14 }}>Operating earnings before interest & taxes</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={cData}>
                  <CartesianGrid {...gridStyle} />
                  <XAxis dataKey="year" tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={v => fmtMoney(v, "")} width={40} />
                  <Tooltip content={<ChartTip sym={sym} />} />
                  <Bar dataKey="EBITDA" fill={C.chartA} radius={[5, 5, 0, 0]} opacity={.9} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="fs-chart-card">
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 3 }}>Free Cash Flow</div>
              <div style={{ color: C.textMuted, fontSize: 11.5, marginBottom: 14 }}>Cash after capital expenditure</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={cData}>
                  <CartesianGrid {...gridStyle} />
                  <XAxis dataKey="year" tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={v => fmtMoney(v, "")} width={40} />
                  <Tooltip content={<ChartTip sym={sym} />} />
                  <Bar dataKey="FCF" fill={C.chartB} radius={[5, 5, 0, 0]} opacity={.9} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="fs-analysis-grid" style={{ marginBottom: 24 }}>
            <div className="fs-analysis-card">
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 24, height: 24, borderRadius: 6, background: C.accentLight, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: C.accent }}>✦</span>
                AI Financial Analysis
              </div>
              {String(data.analysis).split(/\n+/).filter(Boolean).map((p, i) => (
                <p key={i} style={{ color: C.textSec, lineHeight: 1.8, fontSize: 14, marginBottom: 11 }}>{p}</p>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, boxShadow: C.shadow }}>
                <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, color: C.green, marginBottom: 12, fontSize: 14 }}>✓ Key Strengths</div>
                {data.keyStrengths.map((s, i) => (
                  <div key={i} style={{ color: C.textSec, fontSize: 13, lineHeight: 1.7, marginBottom: 10, paddingLeft: 12, borderLeft: `2px solid ${C.green}33` }}>{s}</div>
                ))}
              </div>

              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, boxShadow: C.shadow }}>
                <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, color: C.red, marginBottom: 12, fontSize: 14 }}>⚠ Key Risks</div>
                {data.keyRisks.map((r, i) => (
                  <div key={i} style={{ color: C.textSec, fontSize: 13, lineHeight: 1.7, marginBottom: 10, paddingLeft: 12, borderLeft: `2px solid ${C.red}33` }}>{r}</div>
                ))}
              </div>

              <div style={{ background: oc.bg, border: `1px solid ${oc.color}33`, borderRadius: 14, padding: 16 }}>
                <div style={{ color: oc.color, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{data.outlook} Outlook</div>
                <div style={{ color: C.textSec, fontSize: 13, lineHeight: 1.7 }}>{data.outlookReason}</div>
              </div>
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
   ROOT COMPONENT — wraps everything with Clerk authentication
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
