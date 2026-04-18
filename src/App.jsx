import { useState, useEffect } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";

/* ═════════════════════════════════════════════════════════════
   FinSight AI — by Pallav Shah
   SECURE VERSION — API key hidden on server
════════════════════════════════════════════════════════════════ */

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

// 🔒 API now goes through our own backend — key is safe!
const API_URL = "/api/claude";
const MODEL   = "claude-sonnet-4-5";

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
  "Fetching 5-year revenue data",
  "Analyzing profitability trends",
  "Computing key financial ratios",
  "Generating AI insights",
  "Building your dashboard",
];

const SYSTEM_PROMPT = `You are a financial data analyst with web search access. Search for real 5-year financial data and return ONLY raw JSON. No markdown, no backticks — only the JSON object.

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
  "years": [2020, 2021, 2022, 2023, 2024],
  "revenue": [n, n, n, n, n],
  "netIncome": [n, n, n, n, n],
  "ebitda": [n, n, n, n, n],
  "freeCashFlow": [n, n, n, n, n],
  "grossMargin": [n, n, n, n, n],
  "netMargin": [n, n, n, n, n],
  "eps": [n, n, n, n, n],
  "marketCap": number,
  "peRatio": number,
  "revenueCAGR": number,
  "analysis": "4 paragraphs: revenue growth, profitability, cash flow, competitive outlook. Include specific numbers.",
  "keyStrengths": ["strength with data", "strength with data", "strength with data"],
  "keyRisks": ["risk with context", "risk with context", "risk with context"],
  "outlook": "Bullish or Neutral or Bearish",
  "outlookReason": "One concise sentence"
}`;

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
  <div className="fs-card" style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 14px", boxShadow: C.shadow, transition: "all .2s" }}>
    <div style={{ color: C.textMuted, fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".7px", marginBottom: 8 }}>{label}</div>
    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 17, fontWeight: 500, color: accent || C.textPrimary, marginBottom: 4 }}>{value}</div>
    <div style={{ color: C.textMuted, fontSize: 11 }}>{sub}</div>
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
  body { background: ${C.bgPage}; }
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
  @keyframes fs-fade { from{opacity:0;transform:translateY(12px);} to{opacity:1;transform:none;} }
  @keyframes fs-spin { to { transform: rotate(360deg); } }
  @keyframes fs-step { from{opacity:0;transform:translateX(-8px);} to{opacity:1;transform:none;} }
`;

export default function FinSightAI() {
  const [screen, setScreen]         = useState("landing");
  const [q, setQ]                   = useState("");
  const [data, setData]             = useState(null);
  const [err, setErr]               = useState("");
  const [stepIdx, setStepIdx]       = useState(0);
  const [modal, setModal]           = useState(null);
  const [scriptText, setScriptText] = useState("");
  const [scriptLoading, setScriptLoading] = useState(false);

  useEffect(() => {
    if (screen !== "loading") return;
    setStepIdx(0);
    const t = setInterval(() => setStepIdx(i => Math.min(i + 1, STEPS.length - 1)), 2800);
    return () => clearInterval(t);
  }, [screen]);

  const analyze = async (company) => {
    setScreen("loading"); setErr(""); setScriptText(""); setModal(null);
    try {
      const raw = await callClaude({
        system: SYSTEM_PROMPT,
        userMsg: `Find and analyze 5-year financial data (2020–2024) for: ${company}. Use web search for real numbers. Return ONLY JSON.`,
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
        userMsg: `Write a 5-minute podcast between hosts ALEX and PRIYA analyzing ${d.company} (${d.ticker}).
Revenue: ${revStr}. Net Income: ${niStr}. CAGR: ${d.revenueCAGR}%.
Outlook: ${d.outlook} — ${d.outlookReason}.
Strengths: ${d.keyStrengths.join("; ")}. Risks: ${d.keyRisks.join("; ")}.
Format strictly as alternating ALEX: and PRIYA: turns, 2–3 sentences each.`,
        maxTokens: 1800,
      });
      setScriptText(text);
    } catch { setScriptText("Failed to generate script. Please try again."); }
    setScriptLoading(false);
  };

  const openGamma = () => {
    const d = data, sym = d.currencySymbol;
    const prompt = `Create a professional 8-slide financial analysis presentation for ${d.company} (${d.ticker}, ${d.exchange}).
Revenue 5yr: ${d.years.map((y, i) => `${y}: ${sym}${(d.revenue[i] / 1000).toFixed(1)}B`).join(", ")}.
Net Income 5yr: ${d.years.map((y, i) => `${y}: ${sym}${(d.netIncome[i] / 1000).toFixed(1)}B`).join(", ")}.
CAGR: ${d.revenueCAGR}%. Market Cap: ${sym}${(d.marketCap/1000).toFixed(1)}B. P/E: ${d.peRatio}x. Sector: ${d.sector}.
Outlook: ${d.outlook}. Strengths: ${d.keyStrengths.join(", ")}. Risks: ${d.keyRisks.join(", ")}.
Slides: 1) Company Overview 2) 5-Year Revenue Journey 3) Profitability 4) Cash Flow 5) Key Metrics 6) Strengths & Risks 7) Outlook 8) Summary`;
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

      <header style={{ height: 56, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 28px", background: C.bgCard }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <FinSightLogo size={28} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 15, color: C.textPrimary, letterSpacing: "-.3px", lineHeight: 1 }}>FinSight AI</span>
            <span style={{ fontSize: 9.5, color: C.textMuted, letterSpacing: ".4px", marginTop: 2 }}>by <span style={{ color: C.accent, fontWeight: 600 }}>Pallav Shah</span></span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: C.textSec, background: C.bgSidebar, border: `1px solid ${C.border}`, borderRadius: 20, padding: "4px 12px", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.green }} />
          Powered by Claude
        </span>
      </header>

      <main style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 24px 32px", animation: "fs-fade .6s ease both" }}>
        <div style={{ marginBottom: 28 }}><FinSightLogo size={72} /></div>

        <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: "clamp(30px, 5.5vw, 48px)", fontWeight: 800, color: C.textPrimary, letterSpacing: "-1.5px", textAlign: "center", lineHeight: 1.15, marginBottom: 14 }}>
          Financial intelligence,<br />
          <span style={{ color: C.accent }}>one company at a time.</span>
        </h1>

        <p style={{ color: C.textSec, fontSize: 16, lineHeight: 1.7, textAlign: "center", maxWidth: 540, marginBottom: 36 }}>
          Type any company name. Get a 5-year financial deep-dive with AI analysis, interactive charts, PPT deck, and podcast script.
        </p>

        <div style={{ width: "100%", maxWidth: 580, marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 8, background: C.bgCard, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: "7px 7px 7px 16px", boxShadow: C.shadow }}>
            <input
              className="fs-input"
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === "Enter" && q.trim() && analyze(q.trim())}
              placeholder="e.g. Apple, Reliance Industries, Tesla, TCS..."
              style={{ flex: 1, background: "none", border: "none", outline: "none", color: C.textPrimary, fontSize: 15, fontFamily: "inherit" }}
            />
            <button
              className="fs-btn-primary"
              onClick={() => q.trim() && analyze(q.trim())}
              disabled={!q.trim()}
              style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 10, padding: "11px 22px", fontSize: 14, fontWeight: 600, fontFamily: "'Plus Jakarta Sans', sans-serif", cursor: "pointer", whiteSpace: "nowrap", opacity: q.trim() ? 1 : .55 }}
            >
              Analyze →
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", marginBottom: 48 }}>
          {[{ flag: "🇺🇸", label: "US", items: US_EX }, { flag: "🇮🇳", label: "India", items: IN_EX }].map(row => (
            <div key={row.flag} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <span style={{ fontSize: 12, color: C.textMuted, minWidth: 70, textAlign: "right", fontWeight: 500 }}>{row.flag} {row.label}</span>
              {row.items.map(c => (
                <button key={c} className="fs-chip" onClick={() => analyze(c)} style={{ background: C.bgCard, border: `1px solid ${C.border}`, color: C.textSec, borderRadius: 20, padding: "5px 14px", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>{c}</button>
              ))}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", justifyContent: "center" }}>
          {[
            { icon: "📈", text: "5-Year Analysis" },
            { icon: "📊", text: "Auto PPT via Gamma" },
            { icon: "🎙️", text: "AI Podcast Script" },
            { icon: "🌍", text: "US + India Markets" },
          ].map(f => (
            <div key={f.text} style={{ display: "flex", alignItems: "center", gap: 7, color: C.textSec, fontSize: 13 }}>
              <span style={{ fontSize: 15 }}>{f.icon}</span>
              <span>{f.text}</span>
            </div>
          ))}
        </div>
      </main>

      <footer style={{ padding: "20px 24px", textAlign: "center", borderTop: `1px solid ${C.border}`, background: C.bgCard }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ color: C.textMuted, fontSize: 12 }}>FinSight AI · Financial intelligence for everyone</span>
          <span style={{ color: C.border }}>·</span>
          <Byline />
        </div>
      </footer>
    </div>
  );

  if (screen === "loading") return (
    <div style={{ minHeight: "100vh", background: C.bgPage, fontFamily: "'DM Sans', system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <style>{FONTS + GLOBAL_CSS}</style>
      <div style={{ marginBottom: 28 }}><FinSightLogo size={56} /></div>
      <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 22, fontWeight: 700, color: C.textPrimary, marginBottom: 6 }}>Analyzing financials…</h2>
      <p style={{ color: C.textSec, fontSize: 14, marginBottom: 44 }}>Searching live data — takes about 20–30 seconds</p>
      <div style={{ width: 320 }}>
        {STEPS.map((s, i) => {
          const done = i < stepIdx, active = i === stepIdx, pending = i > stepIdx;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, opacity: pending ? .32 : 1, transition: "opacity .4s", animation: active ? "fs-step .3s ease" : "none" }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: done ? C.green : active ? C.accent : C.border }}>
                {done ? <span style={{ color: "#fff", fontSize: 12 }}>✓</span> : active ? <Spinner /> : null}
              </div>
              <span style={{ fontSize: 14, color: done ? C.green : active ? C.accent : C.textMuted, fontWeight: active ? 600 : 400 }}>{s}</span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 48 }}><Byline /></div>
    </div>
  );

  if (screen === "error") return (
    <div style={{ minHeight: "100vh", background: C.bgPage, fontFamily: "'DM Sans', system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
      <style>{FONTS + GLOBAL_CSS}</style>
      <div style={{ width: 56, height: 56, borderRadius: 16, background: C.redBg, border: `1px solid ${C.red}33`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, marginBottom: 20 }}>⚠️</div>
      <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 20, fontWeight: 700, color: C.red, marginBottom: 10 }}>Analysis failed</h2>
      <p style={{ color: C.textSec, maxWidth: 440, lineHeight: 1.7, marginBottom: 28, fontSize: 14 }}>{err}</p>
      <button onClick={() => setScreen("landing")} style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 10, padding: "11px 28px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>← Try again</button>
    </div>
  );

  if (screen === "dashboard" && data) {
    const sym = data.currencySymbol || "$";
    const OUTLOOK = {
      Bullish: { color: C.green, bg: C.greenBg },
      Neutral: { color: C.amber, bg: C.amberBg },
      Bearish: { color: C.red, bg: C.redBg },
    };
    const oc = OUTLOOK[data.outlook] || OUTLOOK.Neutral;
    const latestRev = data.revenue?.[4], latestNI = data.netIncome?.[4];
    const latestFCF = data.freeCashFlow?.[4], latestNM = data.netMargin?.[4];
    const axisStyle = { fontSize: 11, fill: C.textMuted };
    const gridStyle = { strokeDasharray: "4 4", stroke: C.border };

    return (
      <div style={{ minHeight: "100vh", background: C.bgPage, color: C.textPrimary, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
        <style>{FONTS + GLOBAL_CSS}</style>

        <header style={{ position: "sticky", top: 0, zIndex: 100, height: 60, background: C.bgCard, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 28px", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <FinSightLogo size={26} />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 14, color: C.textPrimary, lineHeight: 1 }}>FinSight AI</span>
              <span style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>by <span style={{ color: C.accent, fontWeight: 600 }}>Pallav Shah</span></span>
            </div>
          </div>
          <div style={{ width: 1, height: 24, background: C.border }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 15, fontWeight: 700, color: C.textPrimary }}>{data.company}</span>
            <span style={{ background: C.bgSidebar, color: C.textSec, fontSize: 11, fontFamily: "'DM Mono', monospace", padding: "2px 8px", borderRadius: 5, border: `1px solid ${C.border}` }}>{data.ticker}</span>
            <span style={{ background: C.bgSidebar, color: C.textMuted, fontSize: 11, padding: "2px 8px", borderRadius: 5, border: `1px solid ${C.border}` }}>{data.exchange}</span>
            <span style={{ background: oc.bg, color: oc.color, fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 5 }}>{data.outlook}</span>
          </div>
          <span style={{ color: C.textMuted, fontSize: 12, display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            {data.market === "India" ? "🇮🇳" : data.market === "US" ? "🇺🇸" : "🌍"} {data.sector}
          </span>
          <button onClick={() => setScreen("landing")} style={{ background: "none", border: `1px solid ${C.border}`, color: C.textSec, borderRadius: 8, padding: "7px 16px", cursor: "pointer", fontSize: 13, whiteSpace: "nowrap", fontFamily: "inherit" }}>← New search</button>
        </header>

        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 24px 24px" }}>
          <p style={{ color: C.textSec, fontSize: 14.5, lineHeight: 1.75, maxWidth: 680, marginBottom: 28 }}>{data.description}</p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 12, marginBottom: 28 }}>
            {[
              { label: "2024 Revenue",    value: fmtMoney(latestRev, sym), sub: `CAGR ${Number(data.revenueCAGR).toFixed(1)}%` },
              { label: "2024 Net Income", value: fmtMoney(latestNI,  sym), sub: `Margin ${Number(latestNM).toFixed(1)}%` },
              { label: "Market Cap",      value: fmtMoney(data.marketCap, sym), sub: data.exchange },
              { label: "P/E Ratio",       value: data.peRatio ? `${Number(data.peRatio).toFixed(1)}×` : "N/A", sub: "Current" },
              { label: "Free Cash Flow",  value: fmtMoney(latestFCF, sym), sub: "2024" },
              { label: "Revenue CAGR",    value: `${Number(data.revenueCAGR).toFixed(1)}%`, sub: "5-Year", accent: C.accent },
            ].map(m => <MetricCard key={m.label} {...m} />)}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, boxShadow: C.shadow }}>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 3 }}>Revenue & Net Income</div>
              <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 18 }}>5-year trend · {data.currency} millions</div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={cData}>
                  <defs>
                    <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.chartA} stopOpacity={.22}/><stop offset="100%" stopColor={C.chartA} stopOpacity={0}/></linearGradient>
                    <linearGradient id="gB" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.chartB} stopOpacity={.22}/><stop offset="100%" stopColor={C.chartB} stopOpacity={0}/></linearGradient>
                  </defs>
                  <CartesianGrid {...gridStyle} />
                  <XAxis dataKey="year" tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={v => fmtMoney(v, "")} />
                  <Tooltip content={<ChartTip sym={sym} />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: C.textSec }} />
                  <Area type="monotone" dataKey="Revenue"    stroke={C.chartA} fill="url(#gA)" strokeWidth={2.2} dot={{ fill: C.chartA, r: 3, strokeWidth: 0 }} />
                  <Area type="monotone" dataKey="Net Income" stroke={C.chartB} fill="url(#gB)" strokeWidth={2.2} dot={{ fill: C.chartB, r: 3, strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, boxShadow: C.shadow }}>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 3 }}>Profit Margins</div>
              <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 18 }}>Gross & Net margin trends · %</div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={cData}>
                  <CartesianGrid {...gridStyle} />
                  <XAxis dataKey="year" tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                  <Tooltip content={<ChartTip isPct />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: C.textSec }} />
                  <Line type="monotone" dataKey="Gross Margin" stroke={C.chartC} strokeWidth={2.4} dot={{ fill: C.chartC, r: 4, strokeWidth: 0 }} />
                  <Line type="monotone" dataKey="Net Margin"   stroke={C.chartD} strokeWidth={2.4} dot={{ fill: C.chartD, r: 4, strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, boxShadow: C.shadow }}>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 3 }}>EBITDA</div>
              <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 18 }}>Operating earnings before interest & taxes</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={cData}>
                  <CartesianGrid {...gridStyle} />
                  <XAxis dataKey="year" tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={v => fmtMoney(v, "")} />
                  <Tooltip content={<ChartTip sym={sym} />} />
                  <Bar dataKey="EBITDA" fill={C.chartA} radius={[5, 5, 0, 0]} opacity={.9} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, boxShadow: C.shadow }}>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 3 }}>Free Cash Flow</div>
              <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 18 }}>Cash after capital expenditure</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={cData}>
                  <CartesianGrid {...gridStyle} />
                  <XAxis dataKey="year" tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={v => fmtMoney(v, "")} />
                  <Tooltip content={<ChartTip sym={sym} />} />
                  <Bar dataKey="FCF" fill={C.chartB} radius={[5, 5, 0, 0]} opacity={.9} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 16, marginBottom: 28 }}>
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28, boxShadow: C.shadow }}>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 24, height: 24, borderRadius: 6, background: C.accentLight, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: C.accent }}>✦</span>
                AI Financial Analysis
              </div>
              {String(data.analysis).split(/\n+/).filter(Boolean).map((p, i) => (
                <p key={i} style={{ color: C.textSec, lineHeight: 1.85, fontSize: 14.5, marginBottom: 12 }}>{p}</p>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22, boxShadow: C.shadow, flex: 1 }}>
                <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, color: C.green, marginBottom: 14, fontSize: 14 }}>✓ Key Strengths</div>
                {data.keyStrengths.map((s, i) => (
                  <div key={i} style={{ color: C.textSec, fontSize: 13, lineHeight: 1.7, marginBottom: 10, paddingLeft: 12, borderLeft: `2px solid ${C.green}33` }}>{s}</div>
                ))}
              </div>

              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22, boxShadow: C.shadow, flex: 1 }}>
                <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, color: C.red, marginBottom: 14, fontSize: 14 }}>⚠ Key Risks</div>
                {data.keyRisks.map((r, i) => (
                  <div key={i} style={{ color: C.textSec, fontSize: 13, lineHeight: 1.7, marginBottom: 10, paddingLeft: 12, borderLeft: `2px solid ${C.red}33` }}>{r}</div>
                ))}
              </div>

              <div style={{ background: oc.bg, border: `1px solid ${oc.color}33`, borderRadius: 14, padding: 18 }}>
                <div style={{ color: oc.color, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{data.outlook} Outlook</div>
                <div style={{ color: C.textSec, fontSize: 13, lineHeight: 1.7 }}>{data.outlookReason}</div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", marginBottom: 32 }}>
            <button className="fs-act" onClick={openGamma} style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 12, padding: "13px 28px", fontSize: 14.5, fontWeight: 600, fontFamily: "'Plus Jakarta Sans', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>📊 Generate PPT via Gamma</button>
            <button className="fs-act" onClick={genScript} style={{ background: C.bgCard, color: C.textPrimary, border: `1px solid ${C.border}`, borderRadius: 12, padding: "13px 28px", fontSize: 14.5, fontWeight: 600, fontFamily: "'Plus Jakarta Sans', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>🎙️ AI Podcast Script</button>
            <button className="fs-act" onClick={() => setScreen("landing")} style={{ background: "transparent", color: C.textSec, border: `1px solid ${C.border}`, borderRadius: 12, padding: "13px 24px", fontSize: 14.5, fontWeight: 500, fontFamily: "inherit", cursor: "pointer" }}>← New search</button>
          </div>

          <div style={{ textAlign: "center", paddingTop: 24, borderTop: `1px solid ${C.border}` }}><Byline /></div>
        </div>

        {modal === "script" && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(31,27,24,.5)", backdropFilter: "blur(4px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 18, width: "100%", maxWidth: 720, maxHeight: "82vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(31,27,24,.3)" }}>
              <div style={{ padding: "18px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: C.bgSidebar }}>
                <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 15 }}>🎙️ AI Podcast Script — {data.company}</div>
                <button onClick={() => setModal(null)} style={{ background: "none", border: "none", color: C.textMuted, fontSize: 20, cursor: "pointer", padding: 4 }}>✕</button>
              </div>
              <div style={{ overflowY: "auto", flex: 1, padding: 24 }}>
                {scriptLoading ? (
                  <div style={{ textAlign: "center", padding: 60, color: C.textSec, fontSize: 14, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                    <Spinner />Generating your podcast script... ~15 seconds
                  </div>
                ) : (
                  scriptText.split("\n").filter(Boolean).map((line, i) => {
                    const isA = line.startsWith("ALEX:");
                    const isP = line.startsWith("PRIYA:");
                    if (!isA && !isP) return <div key={i} style={{ color: C.textMuted, fontSize: 12, fontStyle: "italic", textAlign: "center", margin: "10px 0" }}>{line}</div>;
                    return (
                      <div key={i} style={{ display: "flex", gap: 10, marginBottom: 14, flexDirection: isA ? "row" : "row-reverse" }}>
                        <div style={{ width: 34, height: 34, borderRadius: "50%", background: isA ? C.accentLight : C.blueBg, color: isA ? C.accent : C.chartC, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                          {isA ? "A" : "P"}
                        </div>
                        <div style={{ background: isA ? C.bgSidebar : C.blueBg, borderRadius: isA ? "4px 14px 14px 14px" : "14px 4px 14px 14px", padding: "11px 16px", maxWidth: "78%", color: C.textPrimary, fontSize: 14, lineHeight: 1.7 }}>
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
          <div style={{ position: "fixed", inset: 0, background: "rgba(31,27,24,.5)", backdropFilter: "blur(4px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 18, padding: "40px 36px", maxWidth: 460, width: "100%", textAlign: "center", boxShadow: "0 20px 60px rgba(31,27,24,.3)" }}>
              <div style={{ width: 64, height: 64, borderRadius: 18, background: C.greenBg, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 28, marginBottom: 20 }}>✓</div>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 20, fontWeight: 700, color: C.textPrimary, marginBottom: 10 }}>Prompt copied!</div>
              <div style={{ color: C.textSec, fontSize: 14, marginBottom: 8, lineHeight: 1.7 }}>Gamma has opened in a new tab.</div>
              <div style={{ color: C.textSec, fontSize: 14, marginBottom: 24, lineHeight: 1.7 }}>Just <strong style={{ color: C.textPrimary }}>paste (⌘V / Ctrl+V)</strong> into Gamma's prompt box and click <strong>Generate</strong>.</div>
              <button onClick={() => setModal(null)} style={{ background: "none", border: `1px solid ${C.border}`, color: C.textSec, borderRadius: 8, padding: "10px 28px", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>Close</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
