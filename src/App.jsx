import { useState, useEffect, useRef } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, ComposedChart, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList
} from "recharts";
import { ClerkProvider, SignedIn, SignedOut, SignIn, UserButton, useUser } from "@clerk/clerk-react";

const CLERK_PUB_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const C = {
  bgPage: "#F9F7F4", bgSidebar: "#EFEBE4", bgCard: "#FFFFFF",
  border: "#E8E1D8", borderHover: "#DDD2C2",
  accent: "#CF6B4E", accentDark: "#A8553C", accentLight: "#FDF0EC",
  textPrimary: "#1F1B18", textSec: "#6B6158", textMuted: "#9E9890",
  green: "#2D7D5C", greenBg: "#F0FAF5",
  red: "#C04040", redBg: "#FDF2F2",
  amber: "#A8761F", amberBg: "#FEF7E6",
  brown: "#8B4513", brownLight: "#F5EFE7",
  chartA: "#CF6B4E", chartB: "#2D7D5C", chartC: "#3B82B0",
  chartD: "#7C5CB8", chartE: "#D9A441", chartF: "#8B6F47",
  shadow: "0 1px 3px rgba(0,0,0,.05), 0 2px 8px rgba(0,0,0,.03)",
  shadowMd: "0 2px 12px rgba(0,0,0,.08), 0 1px 4px rgba(0,0,0,.04)",
};

const API_URL = "/api/claude";
const MODEL = "claude-sonnet-4-5";
const AUTHOR_NAME = "Aashni Shah and Hitansh Jhaveri";

const PERIODS = [
  { id: "latest_quarter", label: "Latest Quarter", short: "Latest Q", desc: "Most recent quarter" },
  { id: "half_yearly", label: "Half Yearly", short: "Half Year", desc: "Last 2 quarters" },
  { id: "1_year", label: "1 Year", short: "1 Year", desc: "Full fiscal year" },
  { id: "2_year", label: "2 Years", short: "2 Years", desc: "YoY comparison" },
  { id: "3_year", label: "3 Years", short: "3 Years", desc: "Medium-term trend" },
  { id: "5_year", label: "5 Years", short: "5 Years", desc: "Long-term history" },
];
const DEFAULT_PERIOD = "1_year";

async function callClaude({ system, userMsg, tools = [], maxTokens = 4000 }) {
  const RETRYABLE = new Set([429, 503, 529]);
  const MAX_RETRIES = 3;
  const body = { model: MODEL, max_tokens: maxTokens, messages: [{ role: "user", content: userMsg }] };
  if (system) body.system = system;
  if (tools.length) body.tools = tools;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);
    let res;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        const isLastAttempt = attempt > MAX_RETRIES;
        console.warn(`callClaude attempt ${attempt}: request timed out after 90s`);
        if (isLastAttempt) throw new Error("Rate limit exceeded after 3 retries. Please try again in a few minutes.");
        continue;
      }
      throw err;
    }
    clearTimeout(timeoutId);

    if (RETRYABLE.has(res.status)) {
      const isLastAttempt = attempt > MAX_RETRIES;
      const baseWait = parseInt(res.headers.get("retry-after") || "60", 10);
      const waitSeconds = baseWait * Math.pow(2, attempt - 1);
      console.warn(`callClaude attempt ${attempt}: status ${res.status}, waiting ${waitSeconds}s before retry`);
      if (isLastAttempt) throw new Error("Rate limit exceeded after 3 retries. Please try again in a few minutes.");
      await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
      continue;
    }

    const json = await res.json();
    if (json.error) throw new Error(json.error.message || "API call failed");
    return json.content.filter(b => b.type === "text").map(b => b.text).join("");
  }
}

function cleanText(text) {
  if (!text) return text;
  if (Array.isArray(text)) return text.map(cleanText);
  if (typeof text !== 'string') return text;
  return text.replace(/<cite[^>]*>/gi, '').replace(/<\/cite>/gi, '').replace(/\s+/g, ' ').trim();
}

// CRITICAL v6.0: XBRL Tag Cleaner - removes all machine tags from text
function cleanXbrlText(text) {
  if (text == null) return text;
  let s = String(text);
  s = s.replace(/\s*\[\s*Text\s*Block\s*\]\s*/gi, ' ');
  s = s.replace(/\s*\[\s*Axis\s*\]\s*/gi, ' ');
  s = s.replace(/\s*\[\s*Member\s*\]\s*/gi, ' ');
  s = s.replace(/\s*\[\s*Table\s*\]\s*/gi, ' ');
  s = s.replace(/\s*\[\s*Abstract\s*\]\s*/gi, ' ');
  s = s.replace(/\s*\[\s*pure\s*\]\s*/gi, ' ');
  s = s.replace(/\s*\[\s*shares\s*\]\s*/gi, ' ');
  s = s.replace(/\s*\[\s*INR\s*\/\s*shares\s*\]\s*/gi, ' ');
  s = s.replace(/\s*\[\s*INR\s*\]\s*/gi, ' ');
  s = s.replace(/\s*\[\s*USD\s*\]\s*/gi, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[-–—\s]+|[-–—\s]+$/g, '').trim();
  return s;
}

// CRITICAL v6.0: Humanize machine-oriented XBRL titles
function humanizeTitle(title) {
  if (!title) return "";
  let t = cleanXbrlText(title);
  t = t.replace(/^Disclosure of\s+/i, 'Notes on ');
  t = t.replace(/\s+explanatory\s*$/i, '');
  t = t.replace(/^Subclassification and notes on\s+/i, 'Notes on ');
  t = t.replace(/^Notes\s*-\s*/i, 'Notes on ');
  t = t.replace(/\s+\[Abstract\]/gi, '');
  t = t.replace(/^Statement of\s+/i, 'Statement of ');
  return t.replace(/\s+/g, ' ').trim();
}

// CRITICAL v6.0: Non-breaking dates - collapses "01/04/2024 to 31/03/2025" into a single
// unbroken token using en-dash so pdfmake (which ignores \u00A0) cannot split it mid-range.
function preserveDateRanges(text) {
  if (!text) return text;
  let s = String(text);
  s = s.replace(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s+to\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/g, '$1\u2013$2');
  s = s.replace(/(\d{1,2}-\d{1,2}-\d{2,4})\s+to\s+(\d{1,2}-\d{1,2}-\d{2,4})/g, '$1\u2013$2');
  return s;
}

// Combined cleaner - applies all v6.0 cleaning rules
function fullClean(text) {
  if (text == null) return text;
  let s = cleanXbrlText(text);
  s = preserveDateRanges(s);
  return s;
}

function fmtMoney(val, sym = "$") {
  if (val == null || isNaN(val)) return "N/A";
  const abs = Math.abs(val), sign = val < 0 ? "−" : "";
  if (abs >= 1e6) return `${sign}${sym}${(abs / 1e6).toFixed(2)}T`;
  if (abs >= 1000) return `${sign}${sym}${(abs / 1000).toFixed(1)}B`;
  return `${sign}${sym}${Math.round(abs)}M`;
}

function calcGrowth(arr, idx) {
  if (!arr || idx <= 0 || arr[idx] == null || arr[idx - 1] == null) return null;
  const prev = arr[idx - 1];
  if (prev === 0) return null;
  return ((arr[idx] - prev) / Math.abs(prev)) * 100;
}

function formatCellValue(val) {
  if (val == null || val === undefined) return "—";
  let str = String(val).trim();
  if (!str) return "—";
  str = cleanXbrlText(str);
  if (!str) return "—";
  const lower = str.toLowerCase();
  if (lower === "null" || lower === "undefined" || lower === "n/a" || lower === "na") return "—";
  if (["0", "0.00", "0.0", "0.0000", "0.000", "-", "0%", "0.00%"].includes(str)) return "—";
  const numStr = str.replace(/,/g, "");
  if (!isNaN(parseFloat(numStr)) && parseFloat(numStr) === 0) return "—";
  if (str.match(/^-\d/) && !str.includes(" ")) return "(" + str.substring(1) + ")";
  return str;
}

function isNumericString(val) {
  if (val == null) return false;
  const str = String(val).replace(/[,()%]/g, "").trim();
  return !isNaN(parseFloat(str)) && isFinite(parseFloat(str));
}

function isRowMeaningful(row, labelColIdx = 0) {
  if (!Array.isArray(row) || row.length === 0) return false;
  const label = String(row[labelColIdx] || "").trim();
  if (!label) return false;
  for (let i = 0; i < row.length; i++) {
    if (i === labelColIdx) continue;
    const v = String(row[i] || "").trim();
    if (v && !["0", "0.00", "0.0", "0.0000", "0.000", "", "-", "—", "null", "undefined"].includes(v.toLowerCase())) {
      return true;
    }
  }
  if (label.length > 0 && label.toLowerCase().includes("total")) return true;
  return false;
}

function splitNarrativeIntoParagraphs(text) {
  if (!text) return [];
  let paras = text.split(/\n\s*\n+/).map(p => p.trim()).filter(p => p.length > 0);
  if (paras.length <= 1) {
    paras = text.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0);
  }
  const result = [];
  for (const para of paras) {
    if (para.length <= 800) { result.push(para); continue; }
    const sentences = para.match(/[^.!?]+[.!?]+(\s|$)/g) || [para];
    let current = "";
    for (const s of sentences) {
      if ((current + s).length > 600 && current.length > 100) {
        result.push(current.trim());
        current = s;
      } else current += s;
    }
    if (current.trim()) result.push(current.trim());
  }
  return result.filter(Boolean);
}

async function loadSheetJS() {
  if (window.XLSX) return window.XLSX;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error('Failed to load Excel library'));
    document.head.appendChild(script);
  });
}

async function loadPptxGenJS() {
  if (window.PptxGenJS) return window.PptxGenJS;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
    script.onload = () => resolve(window.PptxGenJS);
    script.onerror = () => reject(new Error('Failed to load PPT library'));
    document.head.appendChild(script);
  });
}

async function loadMammoth() {
  if (window.mammoth) return window.mammoth;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js';
    script.onload = () => resolve(window.mammoth);
    script.onerror = () => reject(new Error('Failed to load Word reader'));
    document.head.appendChild(script);
  });
}

async function loadDocx() {
  if (window.docx) return window.docx;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.min.js';
    script.onload = () => resolve(window.docx);
    script.onerror = () => reject(new Error('Failed to load Word generator'));
    document.head.appendChild(script);
  });
}

async function extractWordContent(file) {
  const mammoth = await loadMammoth();
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  const mod = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs');
  const lib = mod.default ?? mod;
  lib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';
  window.pdfjsLib = lib;
  return lib;
}

async function extractPdfContent(file) {
  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageTexts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map((item) => item.str).join(' '));
  }
  return pageTexts.join('\n\n');
}

function chunkText(text, maxCharsPerChunk = 12000, overlap = 500) {
  const chunks = [];
  const paragraphs = text.split(/\n\s*\n/);
  let currentChunk = "";
  for (const para of paragraphs) {
    if ((currentChunk + para).length > maxCharsPerChunk && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      const tail = currentChunk.length > overlap ? currentChunk.slice(-overlap) : "";
      currentChunk = (tail ? `[CONTEXT FROM END OF PREVIOUS CHUNK - DO NOT RE-OUTPUT THIS]\n${tail}\n[END CONTEXT - NEW CONTENT STARTS HERE]\n\n` : "") + para + "\n\n";
    } else currentChunk += para + "\n\n";
  }
  if (currentChunk.trim().length > 0) chunks.push(currentChunk.trim());
  return chunks;
}

function buildChunkOrganizationPrompt(chunkIndex, totalChunks, companyContext) {
  return `You are processing chunk ${chunkIndex} of ${totalChunks} from an Indian private company's MCA-compliant financial document. Output goes DIRECTLY to corporate users — they need clean, professional, complete content.

IMPORTANT: Your response MUST fit within 8000 output tokens. Be complete but efficient. Use shorter paragraph rewrites where possible while preserving meaning.

═══════════════════════════════════════
PART A — XBRL/MACHINE TAG CLEANING (MANDATORY)
═══════════════════════════════════════

Before outputting ANY text, REMOVE these XBRL machine tags from headers, titles, cells:

  [TextBlock], [Text Block], [Axis], [Member], [Table], [Abstract]
  [pure], [shares], [INR/shares], [INR]

EXAMPLES of cleaning:
  ❌ BAD:  "Share capital [Member] 01/04/2024 to 31/03/2025"
  ✅ GOOD: "Share capital — 01/04/2024 to 31/03/2025"
  
  ❌ BAD:  "Disclosure of notes on borrowings explanatory [Text Block]"
  ✅ GOOD: "Notes on Borrowings"
  
  ❌ BAD:  "Reserves and surplus [Abstract]"
  ✅ GOOD: "Reserves and Surplus"
  
  ❌ BAD:  "[shares] 3,49,10,000"
  ✅ GOOD: "3,49,10,000 shares"
  
  ❌ BAD:  "Number of shares authorised [shares]"
  ✅ GOOD: "Number of shares authorised"

NEVER include square-bracketed XBRL tags in your output. Strip them ALL.

═══════════════════════════════════════
PART B — PRESERVE EVERY SECTION (MANDATORY)
═══════════════════════════════════════

🔴 PRIORITY RULE — Director's Report Preamble (MANDATORY):

Before processing any financial tables, scan the chunk for these phrases:
  - "BOARD'S REPORT" / "DIRECTOR'S REPORT" / "DIRECTORS' REPORT"
  - "FINANCIAL HIGHLIGHTS" (with table comparing standalone/consolidated years)
  - "BOARD MEETINGS" / "Number of Board Meetings held during the year"
  - "RISK MANAGEMENT" / "Risk Management Policy" / "Risk Management Committee"
  - "SEXUAL HARASSMENT" / "POSH Act" / "Internal Complaints Committee" / "POSH compliance"
  - "SECRETARIAL STANDARDS" / "Compliance with Secretarial Standards SS-1 and SS-2"
  - "DIVIDEND" (in Director's Report preamble, NOT in financial statements)
  - "TRANSFER TO RESERVES"
  - "CHANGE IN NATURE OF BUSINESS"
  - "MATERIAL CHANGES AND COMMITMENTS"
  - "STATE OF AFFAIRS"
  - "SIGNIFICANT AND MATERIAL ORDERS"
  - "INTERNAL FINANCIAL CONTROLS"
  - "PARTICULARS OF CONTRACTS WITH RELATED PARTIES"
  - "ACKNOWLEDGEMENT" / "Acknowledgement" (closing section)

WHENEVER YOU SEE ANY OF THESE, you MUST output them as:
  {type: "heading", title: "<humanized title>"},
  {type: "paragraph_block", paragraphs: [<full content from source>]}

These are MANDATORY disclosures under Companies Act 2013 Section 134(3).
Skipping them = INCOMPLETE filing = FAIL.

CONCRETE EXAMPLE:
If source contains:
"1. FINANCIAL HIGHLIGHTS:
 The Company achieved revenue of Rs. 73,698 Lakhs during the year compared
 to Rs. 67,890 Lakhs in the previous year, growth of 8.5%."

You MUST output:
{type: "heading", title: "Financial Highlights"},
{type: "paragraph_block", paragraphs: [
  "The Company achieved revenue of Rs. 73,698 Lakhs during the year compared to Rs. 67,890 Lakhs in the previous year, growth of 8.5%."
]}

If chunk contains these sections, output them in FULL — do NOT skip, do NOT compress:

PREAMBLE NARRATIVE SECTIONS (often numbered 1, 2, 3...):
1. FINANCIAL HIGHLIGHTS — preserve the comparison table (Standalone & Consolidated 2024-25, 2023-24)
2. PRINCIPAL OPERATIONS / Nature of business
3. STATE OF AFFAIRS
4. DIVIDEND
5. TRANSFER TO RESERVES
6. SHARE CAPITAL changes
7. DIRECTORS / KMP changes
8. BOARD MEETINGS held during the year (with dates)
9. SUBSIDIARY / Associate / Joint Venture information / AOC-1
10. CORPORATE SOCIAL RESPONSIBILITY (CSR)
11. RISK MANAGEMENT
12. INTERNAL FINANCIAL CONTROLS
13. AUDITORS report and qualifications
14. RELATED PARTY transactions
15. FOREIGN EXCHANGE earnings & outgo
16. CONSERVATION OF ENERGY
17. SEXUAL HARASSMENT / POSH policy compliance
18. SECRETARIAL STANDARDS compliance
19. WHISTLE BLOWER policy
20. OTHER DISCLOSURES
21. ACKNOWLEDGEMENT (the closing thank-you from directors)
22. All ANNEXURES (A, B, C, D)
23. INDEPENDENT AUDITOR'S REPORT
24. CARO Reporting (clause by clause, 3(i) through 3(xxi))
25. NOTES TO FINANCIAL STATEMENTS (every note)

XBRL NUMBERED SECTIONS (preserve all):
- [400100] Disclosure of general information
- [400200] Auditors report
- [400300] Disclosures - Auditors report  
- [100100] Balance Sheet
- [100200] Statement of profit and loss
- [100400] Cash flow statement
- [200xxx] Notes - Share capital, Reserves, Borrowings, etc
- [201xxx] Notes - Tangible Assets, Intangible, Investments, etc
- [202xxx] Notes - Related party, Provisions, etc
- [300xxx] Notes - Revenue, Expenses

CRITICAL: A chunk's output character count should be AT LEAST as long as input.
If less → you've SUMMARIZED → that's a FAIL.

═══════════════════════════════════════
PART C — OTHER FORMATTING RULES
═══════════════════════════════════════

1. EMPTY/ZERO CELLS: If cell is 0, 0.00, blank → return null. NEVER write "0".
2. NUMBERS PRESERVED EXACTLY: "1,23,456.78" stays as "1,23,456.78". Don't reformat.
3. SKIP EMPTY ROWS: Don't include rows where ALL data cells are 0/empty.
4. NARRATIVE TEXT: split into paragraphs array — one element per source paragraph.
5. KEY-VALUE INFO (Company name, CIN, address, auditor name): use "key_value_table" type.
6. TABLES with data columns: use "table" type with clean headers (after stripping XBRL tags).
7. SECTION TRANSITIONS within chunk: use "section_break" block to mark new sections.

${companyContext ? `\nCOMPANY CONTEXT FROM EARLIER CHUNKS: ${companyContext}\n` : ''}

FINAL VERIFICATION before returning JSON:
Mental checklist — scan the source chunk one more time:
  □ Does it mention 'FINANCIAL HIGHLIGHTS'? → Did I output that section?
  □ Does it mention 'BOARD MEETINGS'? → Did I output that section?
  □ Does it mention 'POSH' or 'SEXUAL HARASSMENT'? → Did I output it?
  □ Does it mention 'SECRETARIAL STANDARDS'? → Did I output it?
  □ Does it mention 'RISK MANAGEMENT'? → Did I output it?
If ANY answer is 'no, I skipped it' — go back and add it before returning.

═══════════════════════════════════════
OUTPUT JSON STRUCTURE (return ONLY this, no markdown)
═══════════════════════════════════════

{
  "chunkSummary": "1-line description",
  "sectionNumber": "[400100]" or "" if not XBRL-numbered,
  "sectionTitle": "Clean human title — e.g. 'Balance Sheet', 'Cash Flow Statement', 'Notes on Share Capital', 'Board Report', etc",
  "blocks": [
    { "type": "section_break", "sectionNumber": "[400500]", "title": "Notes on Borrowings" },
    { "type": "heading", "title": "Main section heading" },
    { "type": "subheading", "title": "Subheading text" },
    {
      "type": "paragraph_block",
      "title": "optional title",
      "paragraphs": ["Para 1 verbatim from source.", "Para 2 verbatim.", "Para 3 verbatim."]
    },
    {
      "type": "bullet_list",
      "title": "optional",
      "items": ["bullet 1", "bullet 2"]
    },
    {
      "type": "key_value_table",
      "title": "Company Information",
      "pairs": [{"label": "Company Name", "value": "B Braun Medical (India) Pvt Ltd"}]
    },
    {
      "type": "table",
      "title": "Balance Sheet",
      "headers": ["Particulars", "31/03/2025", "31/03/2024"],
      "rows": [["Share capital", "34,149.08", "31,909.08"]]
    }
  ],
  "companyInfoFound": {
    "name": "if mentioned", "cin": "if mentioned",
    "period": "if mentioned", "rounding": "Lakhs/Crores",
    "currency": "INR/USD", "sector": "if identifiable"
  },
  "financialDataExtracted": {
    "totalAssets": null or number, "currentAssets": null or number,
    "nonCurrentAssets": null or number, "totalLiabilities": null or number,
    "currentLiabilities": null or number, "nonCurrentLiabilities": null or number,
    "totalEquity": null or number, "longTermDebt": null or number,
    "shortTermDebt": null or number, "inventory": null or number,
    "receivables": null or number, "cash": null or number, "fixedAssets": null or number,
    "revenue": null or number, "grossProfit": null or number,
    "operatingProfit": null or number, "ebitda": null or number,
    "netIncome": null or number, "interestExpense": null or number,
    "tax": null or number, "cogs": null or number,
    "depreciation": null or number, "operatingCashFlow": null or number
  }
}

REMEMBER:
- Apply XBRL CLEANING to every header, title, cell value before outputting.
- PRESERVE every preamble narrative section (Financial Highlights, POSH, Secretarial Standards, etc.)
- financialDataExtracted values: NUMBERS only (latest year), not strings. Convert "34,149.08" to 34149.08.`;
}

async function processChunkWithAI(chunkTextStr, chunkIndex, totalChunks, companyContext, onProgress) {
  onProgress?.(`Processing section ${chunkIndex} of ${totalChunks}...`);
  const systemPrompt = buildChunkOrganizationPrompt(chunkIndex, totalChunks, companyContext);
  const aiResponse = await callClaude({
    system: systemPrompt,
    userMsg: `Process chunk ${chunkIndex} of ${totalChunks}. PRESERVE all content. STRIP all XBRL tags. Return JSON only:\n\n${chunkTextStr}`,
    maxTokens: 8000
  });
  let cleanResponse = aiResponse.trim();
  if (cleanResponse.startsWith('```json')) cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/```\s*$/, '');
  else if (cleanResponse.startsWith('```')) cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(cleanResponse);
  } catch (e) {
    console.error("Failed to parse chunk", chunkIndex, ":", e);
    return {
      chunkSummary: `Chunk ${chunkIndex} - parsing error`,
      sectionNumber: "", sectionTitle: `Section ${chunkIndex}`,
      blocks: [{ type: "paragraph_block", paragraphs: splitNarrativeIntoParagraphs(chunkTextStr) }],
      companyInfoFound: {}, financialDataExtracted: {}
    };
  }
}

function aggregateFinancialData(chunkResults) {
  const aggregated = {
    totalAssets: null, currentAssets: null, nonCurrentAssets: null,
    totalLiabilities: null, currentLiabilities: null, nonCurrentLiabilities: null,
    totalEquity: null, longTermDebt: null, shortTermDebt: null,
    inventory: null, receivables: null, cash: null, fixedAssets: null,
    revenue: null, grossProfit: null, operatingProfit: null, ebitda: null,
    netIncome: null, interestExpense: null, tax: null, cogs: null,
    depreciation: null, operatingCashFlow: null
  };
  for (const chunk of chunkResults) {
    const data = chunk.financialDataExtracted || {};
    for (const key of Object.keys(aggregated)) {
      if (aggregated[key] == null && data[key] != null && !isNaN(parseFloat(data[key]))) {
        aggregated[key] = parseFloat(data[key]);
      }
    }
  }
  return aggregated;
}

function calculateRatios(fd, sectorHint = "general") {
  const fmt = (val, decimals = 2, suffix = "") => {
    if (val == null || isNaN(val) || !isFinite(val)) return "—";
    const sign = val < 0 ? "(" : "";
    const closing = val < 0 ? ")" : "";
    return sign + Math.abs(val).toFixed(decimals) + suffix + closing;
  };
  const safe = (n, d) => (n != null && d != null && d !== 0 && !isNaN(n) && !isNaN(d)) ? (n / d) : null;
  const safeMul = (n, m) => (n != null && m != null && !isNaN(n) && !isNaN(m)) ? (n * m) : null;
  const ratios = [];
  ratios.push({
    category: "Profitability Ratios",
    items: [
      { name: "Gross Margin", value: fmt(safeMul(safe(fd.grossProfit, fd.revenue), 100), 2, "%"), rawValue: safeMul(safe(fd.grossProfit, fd.revenue), 100), formula: "Gross Profit / Revenue × 100", interpretation: "Higher is better. Pricing power and cost efficiency." },
      { name: "Operating Margin", value: fmt(safeMul(safe(fd.operatingProfit, fd.revenue), 100), 2, "%"), rawValue: safeMul(safe(fd.operatingProfit, fd.revenue), 100), formula: "Operating Profit / Revenue × 100", interpretation: "Operating efficiency excluding interest and tax." },
      { name: "Net Margin", value: fmt(safeMul(safe(fd.netIncome, fd.revenue), 100), 2, "%"), rawValue: safeMul(safe(fd.netIncome, fd.revenue), 100), formula: "Net Income / Revenue × 100", interpretation: "Bottom-line profitability after all costs." },
      { name: "Return on Equity (ROE)", value: fmt(safeMul(safe(fd.netIncome, fd.totalEquity), 100), 2, "%"), rawValue: safeMul(safe(fd.netIncome, fd.totalEquity), 100), formula: "Net Income / Total Equity × 100", interpretation: "Returns for shareholders." },
      { name: "Return on Assets (ROA)", value: fmt(safeMul(safe(fd.netIncome, fd.totalAssets), 100), 2, "%"), rawValue: safeMul(safe(fd.netIncome, fd.totalAssets), 100), formula: "Net Income / Total Assets × 100", interpretation: "Asset utilization efficiency." }
    ]
  });
  ratios.push({
    category: "Liquidity Ratios",
    items: [
      { name: "Current Ratio", value: fmt(safe(fd.currentAssets, fd.currentLiabilities), 2, "x"), rawValue: safe(fd.currentAssets, fd.currentLiabilities), formula: "Current Assets / Current Liabilities", interpretation: "Above 1.5 is healthy. Short-term solvency." },
      { name: "Quick Ratio", value: fmt(safe((fd.currentAssets || 0) - (fd.inventory || 0), fd.currentLiabilities), 2, "x"), rawValue: safe((fd.currentAssets || 0) - (fd.inventory || 0), fd.currentLiabilities), formula: "(Current Assets − Inventory) / Current Liabilities", interpretation: "Above 1.0 is healthy. Excludes inventory." }
    ]
  });
  ratios.push({
    category: "Leverage Ratios",
    items: [
      { name: "Debt-to-Equity", value: fmt(safe(fd.longTermDebt, fd.totalEquity), 2, "x"), rawValue: safe(fd.longTermDebt, fd.totalEquity), formula: "Long-term Debt / Total Equity", interpretation: "Lower is safer. Below 1.0 is healthy." },
      { name: "Debt-to-Assets", value: fmt(safe(fd.longTermDebt, fd.totalAssets), 2, "x"), rawValue: safe(fd.longTermDebt, fd.totalAssets), formula: "Long-term Debt / Total Assets", interpretation: "Portion of assets debt-financed." },
      { name: "Interest Coverage", value: fmt(safe(fd.operatingProfit, fd.interestExpense), 2, "x"), rawValue: safe(fd.operatingProfit, fd.interestExpense), formula: "Operating Profit / Interest Expense", interpretation: "Above 3x is healthy." }
    ]
  });
  ratios.push({
    category: "Efficiency Ratios",
    items: [
      { name: "Asset Turnover", value: fmt(safe(fd.revenue, fd.totalAssets), 2, "x"), rawValue: safe(fd.revenue, fd.totalAssets), formula: "Revenue / Total Assets", interpretation: "Efficiency of asset use." },
      { name: "Inventory Turnover", value: fmt(safe(fd.cogs, fd.inventory), 2, "x"), rawValue: safe(fd.cogs, fd.inventory), formula: "COGS / Inventory", interpretation: "Higher = faster inventory turnover." },
      { name: "Receivables Days (DSO)", value: fmt(safeMul(safe(fd.receivables, fd.revenue), 365), 0, " days"), rawValue: safeMul(safe(fd.receivables, fd.revenue), 365), formula: "(Receivables / Revenue) × 365", interpretation: "Lower is better." }
    ]
  });
  const sector = (sectorHint || "").toLowerCase();
  const sectorRatios = [];
  if (sector.includes("medical") || sector.includes("pharma") || sector.includes("health")) {
    sectorRatios.push({
      name: "Working Capital Intensity",
      value: fmt(safeMul(safe((fd.currentAssets || 0) - (fd.currentLiabilities || 0), fd.revenue), 100), 2, "%"),
      rawValue: safeMul(safe((fd.currentAssets || 0) - (fd.currentLiabilities || 0), fd.revenue), 100),
      formula: "Working Capital / Revenue × 100",
      interpretation: "Capital tied up in operations."
    });
  }
  if (sector.includes("manufactur") || sector.includes("medical") || sector.includes("pharma")) {
    sectorRatios.push({
      name: "Fixed Asset Turnover",
      value: fmt(safe(fd.revenue, fd.fixedAssets), 2, "x"),
      rawValue: safe(fd.revenue, fd.fixedAssets),
      formula: "Revenue / Fixed Assets",
      interpretation: "Fixed asset utilization efficiency."
    });
  }
  if (sectorRatios.length > 0) ratios.push({ category: "Sector-Specific Ratios", items: sectorRatios });
  return ratios;
}

async function generateSWOTAndInterpretation(companyInfo, aggregated, ratios, onProgress) {
  onProgress?.("Generating SWOT analysis and ratio interpretations...");
  const ratiosFlat = ratios.flatMap(r => r.items.map(i => `${i.name}: ${i.value} (${r.category})`)).join('\n');
  const systemPrompt = `You are a senior financial analyst for an Indian private company. Generate SPECIFIC SWOT and ratio interpretations - no generic advice.

Output ONLY JSON:
{
  "strengths": ["4-5 specific strengths"],
  "weaknesses": ["4-5 specific weaknesses"],
  "opportunities": ["4-5 specific opportunities"],
  "threats": ["4-5 specific threats"],
  "ratioInterpretations": [
    {"ratio": "Gross Margin", "value": "X%", "meaning": "1-2 lines specific to THIS company in its sector"}
  ]
}

Each bullet 1-2 sentences. Reference the company name and actual numbers.`;

  const userMsg = `Company: ${companyInfo.name}
Sector: ${companyInfo.sector || "Medical/Pharmaceutical"}
Period: ${companyInfo.period}
Values in: ${companyInfo.rounding || "Lakhs"} ${companyInfo.currency || "INR"}

FINANCIAL DATA:
${JSON.stringify(aggregated, null, 2)}

RATIOS:
${ratiosFlat}

Generate company-specific SWOT and interpretations.`;

  try {
    const response = await callClaude({ system: systemPrompt, userMsg, maxTokens: 6000 });
    let clean = response.trim();
    if (clean.startsWith('```json')) clean = clean.replace(/^```json\s*/, '').replace(/```\s*$/, '');
    else if (clean.startsWith('```')) clean = clean.replace(/^```\s*/, '').replace(/```\s*$/, '');
    return JSON.parse(clean);
  } catch (e) {
    console.error("SWOT generation failed:", e);
    return { strengths: [], weaknesses: [], opportunities: [], threats: [], ratioInterpretations: [] };
  }
}

function createFinancialBarChart(data) {
  const canvas = document.createElement('canvas');
  canvas.width = 1400; canvas.height = 800;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#8B4513'; ctx.lineWidth = 4;
  ctx.strokeRect(15, 15, canvas.width - 30, canvas.height - 30);
  ctx.fillStyle = '#8B4513';
  ctx.font = 'bold 36px "Times New Roman"';
  ctx.textAlign = 'center';
  ctx.fillText(data.title, canvas.width / 2, 65);
  ctx.fillStyle = '#666666';
  ctx.font = 'italic 20px "Times New Roman"';
  ctx.fillText(data.subtitle || `Values in ${data.unit || "Lakhs of INR"}`, canvas.width / 2, 100);
  const padding = { top: 150, right: 80, bottom: 130, left: 160 };
  const chartW = canvas.width - padding.left - padding.right;
  const chartH = canvas.height - padding.top - padding.bottom;
  const validValues = data.values.filter(v => v != null && !isNaN(v));
  if (validValues.length === 0) {
    ctx.fillStyle = '#999999';
    ctx.font = 'italic 22px "Times New Roman"';
    ctx.fillText('Insufficient data to render this chart', canvas.width / 2, canvas.height / 2);
    return canvas.toDataURL('image/png');
  }
  const maxVal = Math.max(...validValues, 0);
  const minVal = Math.min(...validValues, 0);
  const range = maxVal - minVal || Math.abs(maxVal) || 1;
  const zeroY = padding.top + (maxVal / range) * chartH;
  ctx.strokeStyle = '#E5E5E5'; ctx.lineWidth = 1;
  ctx.fillStyle = '#666666';
  ctx.font = '16px "Times New Roman"'; ctx.textAlign = 'right';
  const gridSteps = 5;
  for (let i = 0; i <= gridSteps; i++) {
    const y = padding.top + (chartH * i / gridSteps);
    const val = maxVal - (range * i / gridSteps);
    ctx.beginPath(); ctx.moveTo(padding.left, y);
    ctx.lineTo(canvas.width - padding.right, y); ctx.stroke();
    const label = Math.abs(val) >= 100000 ? (val / 100000).toFixed(1) + 'L' : Math.abs(val) >= 1000 ? (val / 1000).toFixed(1) + 'K' : val.toFixed(0);
    ctx.fillText(label, padding.left - 12, y + 6);
  }
  ctx.strokeStyle = '#333333'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + chartH);
  ctx.lineTo(canvas.width - padding.right, padding.top + chartH); ctx.stroke();
  const barWidth = (chartW / data.values.length) * 0.55;
  const barSpacing = chartW / data.values.length;
  const colors = data.colors || ['#CF6B4E', '#2D7D5C', '#3B82B0', '#7C5CB8', '#D9A441', '#8B6F47'];
  data.values.forEach((val, i) => {
    if (val == null || isNaN(val)) {
      ctx.fillStyle = '#999'; ctx.font = 'italic 14px "Times New Roman"'; ctx.textAlign = 'center';
      ctx.fillText('N/A', padding.left + barSpacing * i + barSpacing / 2, zeroY);
    } else {
      const x = padding.left + (barSpacing * i) + (barSpacing - barWidth) / 2;
      const barHeight = Math.abs((val / range) * chartH);
      const y = val >= 0 ? zeroY - barHeight : zeroY;
      const grad = ctx.createLinearGradient(x, y, x, y + barHeight);
      grad.addColorStop(0, colors[i % colors.length]);
      grad.addColorStop(1, colors[i % colors.length] + 'AA');
      ctx.fillStyle = grad; ctx.fillRect(x, y, barWidth, barHeight);
      ctx.fillStyle = '#1F1B18'; ctx.font = 'bold 18px "Times New Roman"'; ctx.textAlign = 'center';
      const label = Math.abs(val) >= 100000 ? (val / 100000).toFixed(1) + 'L' : Math.abs(val) >= 1000 ? (val / 1000).toFixed(1) + 'K' : val.toFixed(0);
      ctx.fillText(label, x + barWidth / 2, val >= 0 ? y - 12 : y + barHeight + 25);
    }
    ctx.fillStyle = '#333333'; ctx.font = '16px "Times New Roman"'; ctx.textAlign = 'center';
    const labelLines = (data.labels[i] || '').split(' ');
    if (labelLines.length > 2) {
      const mid = Math.ceil(labelLines.length / 2);
      ctx.fillText(labelLines.slice(0, mid).join(' '), padding.left + barSpacing * i + barSpacing / 2, padding.top + chartH + 30);
      ctx.fillText(labelLines.slice(mid).join(' '), padding.left + barSpacing * i + barSpacing / 2, padding.top + chartH + 55);
    } else {
      ctx.fillText(data.labels[i] || '', padding.left + barSpacing * i + barSpacing / 2, padding.top + chartH + 35);
    }
  });
  return canvas.toDataURL('image/png');
}

function dataURLToUint8Array(dataURL) {
  const base64 = dataURL.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function generateSmartFilename(companyInfo, extension) {
  const company = (companyInfo.name || 'Private_Company')
    .replace(/\b(Private|Pvt|Limited|Ltd|Public|Plc|Inc|Corp|Corporation|Company|Co|LLP|Group|Holdings)\b/gi, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join('_')
    .substring(0, 25) || 'Private_Company';
  let fyTag = '';
  if (companyInfo.period) {
    const yearMatches = companyInfo.period.match(/\b(20\d{2})\b/g);
    if (yearMatches && yearMatches.length >= 2) {
      fyTag = `_FY${yearMatches[0].slice(-2)}-${yearMatches[1].slice(-2)}`;
    } else if (yearMatches && yearMatches.length === 1) {
      fyTag = `_FY${yearMatches[0].slice(-2)}`;
    }
  }
  return `FinSight_${company}${fyTag}_Financials.${extension}`;
}

async function generateOrganizedWordDoc(chunkResults, companyInfo, ratios, swot, chartImages, originalFileName) {
  const docx = await loadDocx();
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    BorderStyle, AlignmentType, WidthType, PageNumber, Header, Footer, ShadingType, ImageRun
  } = docx;

  const BLACK = "000000", BROWN = "8B4513";
  const GREY_BORDER = "808080", LIGHT_BG = "F5EFE7";

  const cellBorder = {
    top: { style: BorderStyle.SINGLE, size: 4, color: GREY_BORDER },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: GREY_BORDER },
    left: { style: BorderStyle.SINGLE, size: 4, color: GREY_BORDER },
    right: { style: BorderStyle.SINGLE, size: 4, color: GREY_BORDER },
  };

  const txt = (str, opts = {}) => new TextRun({
    text: String(str || ""),
    font: opts.font || "Times New Roman",
    size: opts.size || 22,
    bold: opts.bold || false,
    italics: opts.italics || false,
    color: opts.color || BLACK,
  });

  const para = (children, opts = {}) => new Paragraph({
    children: Array.isArray(children) ? children : [children],
    alignment: opts.align || AlignmentType.LEFT,
    spacing: opts.spacing || { before: 120, after: 120, line: 320 },
  });

  const cell = (children, opts = {}) => new TableCell({
    children: Array.isArray(children) ? children : [children],
    borders: cellBorder,
    width: opts.width,
    shading: opts.shading,
    verticalAlign: "center",
    margins: opts.margins || { top: 100, bottom: 100, left: 120, right: 120 },
  });

  const sectionHeader = (number, title) => para(
    [txt(`${number ? number + " " : ""}${humanizeTitle(title)}`, {
      font: "Times New Roman", size: 32, bold: true, color: BROWN
    })],
    { align: AlignmentType.CENTER, spacing: { before: 700, after: 250, line: 380 } }
  );

  const subSectionHeader = (title) => para(
    [txt(humanizeTitle(title), { font: "Times New Roman", size: 26, bold: true, color: BROWN })],
    { spacing: { before: 450, after: 180, line: 340 } }
  );

  const subheading = (title) => para(
    [txt(humanizeTitle(title), { font: "Times New Roman", size: 24, bold: true, color: BROWN })],
    { spacing: { before: 300, after: 150, line: 320 } }
  );

  const disclaimer = (rounding) => para(
    [txt(`Unless otherwise specified, all monetary values are in ${rounding || "Lakhs"} of INR`, {
      font: "Times New Roman", size: 20, italics: true, color: BROWN
    })],
    { align: AlignmentType.RIGHT, spacing: { before: 100, after: 200 } }
  );

  const blankLine = () => para([txt("", { size: 12 })], { spacing: { before: 100, after: 100 } });
  const pageBreak = () => new Paragraph({ children: [new TextRun({ text: "" })], pageBreakBefore: true });

  const allSections = [];

  // TITLE PAGE
  allSections.push(para([txt("", { size: 16 })], { spacing: { before: 400 } }));
  allSections.push(para(
    [txt(companyInfo.name || "PRIVATE COMPANY", {
      font: "Times New Roman", size: 40, bold: true, color: BROWN
    })],
    { align: AlignmentType.CENTER, spacing: { before: 800, after: 300, line: 440 } }
  ));
  if (companyInfo.period) {
    allSections.push(para(
      [txt(`Standalone Financial Statements`, { font: "Times New Roman", size: 28, italics: true })],
      { align: AlignmentType.CENTER, spacing: { before: 200, after: 120 } }
    ));
    allSections.push(para(
      [txt(`for the period ${preserveDateRanges(companyInfo.period)}`, { font: "Times New Roman", size: 24, italics: true })],
      { align: AlignmentType.CENTER, spacing: { before: 60, after: 400 } }
    ));
  }
  allSections.push(disclaimer(companyInfo.rounding));
  allSections.push(blankLine());

  // CRITICAL v6.0: Track seen headings to prevent duplicates
  const seenHeadings = new Set();
  const headingKey = (number, title) => `${(number || '').toLowerCase()}::${humanizeTitle(title || '').toLowerCase()}`;

  let currentSectionTitle = "";
  let firstSection = true;
  for (const chunkResult of chunkResults) {
    if (!chunkResult.blocks || chunkResult.blocks.length === 0) continue;

    const newSection = chunkResult.sectionTitle || "";
    if (newSection && newSection !== currentSectionTitle) {
      const key = headingKey(chunkResult.sectionNumber, newSection);
      if (!seenHeadings.has(key)) {
        seenHeadings.add(key);
        if (!firstSection) allSections.push(pageBreak());
        allSections.push(sectionHeader(chunkResult.sectionNumber, newSection));
        allSections.push(disclaimer(companyInfo.rounding));
        allSections.push(blankLine());
        firstSection = false;
      }
      currentSectionTitle = newSection;
    }

    for (const block of chunkResult.blocks) {
      if (block.type === "section_break") {
        const key = headingKey(block.sectionNumber, block.title);
        if (seenHeadings.has(key)) continue;
        seenHeadings.add(key);
        allSections.push(pageBreak());
        allSections.push(sectionHeader(block.sectionNumber || "", block.title || ""));
        allSections.push(disclaimer(companyInfo.rounding));
        allSections.push(blankLine());
        currentSectionTitle = block.title || currentSectionTitle;
      } else if (block.type === "heading") {
        const cleaned = humanizeTitle(block.title || "");
        if (!cleaned) continue;
        allSections.push(subSectionHeader(cleaned));
      } else if (block.type === "subheading") {
        const cleaned = humanizeTitle(block.title || "");
        if (!cleaned) continue;
        allSections.push(subheading(cleaned));
      } else if (block.type === "paragraph_block") {
        if (block.title) allSections.push(subheading(block.title));
        const paragraphs = Array.isArray(block.paragraphs) ? block.paragraphs : (block.content ? splitNarrativeIntoParagraphs(block.content) : []);
        for (const p of paragraphs) {
          if (!p || !p.trim()) continue;
          const cleanP = fullClean(p.trim());
          if (!cleanP) continue;
          allSections.push(para(
            [txt(cleanP, { font: "Times New Roman", size: 22 })],
            { align: AlignmentType.JUSTIFIED, spacing: { before: 140, after: 180, line: 340 } }
          ));
        }
      } else if (block.type === "bullet_list" && Array.isArray(block.items)) {
        if (block.title) allSections.push(subheading(block.title));
        for (const item of block.items) {
          if (!item || !item.trim()) continue;
          const cleanItem = fullClean(item.trim());
          if (!cleanItem) continue;
          allSections.push(para(
            [txt("•  ", { font: "Times New Roman", size: 22, bold: true, color: BROWN }), txt(cleanItem, { font: "Times New Roman", size: 22 })],
            { align: AlignmentType.LEFT, spacing: { before: 80, after: 80, line: 320 }, indent: { left: 360, hanging: 200 } }
          ));
        }
      } else if (block.type === "key_value_table" && block.pairs && block.pairs.length > 0) {
        if (block.title) allSections.push(subheading(block.title));
        const tableRows = [];
        for (const pair of block.pairs) {
          if (!pair || !pair.label) continue;
          const labelClean = fullClean(pair.label);
          const valueClean = pair.value == null ? "—" : fullClean(String(pair.value)) || "—";
          tableRows.push(new TableRow({
            children: [
              cell(para(txt(labelClean, { font: "Times New Roman", size: 22, bold: true }), { spacing: { before: 80, after: 80 } }), { width: { size: 42, type: WidthType.PERCENTAGE } }),
              cell(para(txt(valueClean, { font: "Times New Roman", size: 22 }), { spacing: { before: 80, after: 80 } }), { width: { size: 58, type: WidthType.PERCENTAGE } })
            ]
          }));
        }
        if (tableRows.length > 0) {
          allSections.push(new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
          allSections.push(blankLine());
        }
      } else if (block.type === "table" && block.headers && block.headers.length > 0) {
        if (block.title) allSections.push(subheading(block.title));
        
        // CRITICAL v6.0: Wide table handling
        const numCols = block.headers.length;
        const isWideTable = numCols >= 5;
        const isVeryWideTable = numCols >= 7;
        
        const fontSize = isVeryWideTable ? 14 : (isWideTable ? 16 : 20);
        const headerFontSize = isVeryWideTable ? 14 : (isWideTable ? 16 : 18);
        const cellPadding = isWideTable
          ? { top: 50, bottom: 50, left: 70, right: 70 }
          : { top: 100, bottom: 100, left: 120, right: 120 };
        
        const firstColPct = isVeryWideTable ? 22 : (isWideTable ? 28 : 35);
        const otherColPct = (100 - firstColPct) / Math.max(1, (numCols - 1));
        const colWidths = [firstColPct, ...Array(numCols - 1).fill(otherColPct)];
        
        const tableRows = [];
        // Header row with cleaned XBRL tags
        tableRows.push(new TableRow({
          tableHeader: true,
          children: block.headers.map((h, ci) => {
            const cleanH = fullClean(String(h || ""));
            return cell(
              para(txt(cleanH, { font: "Times New Roman", size: headerFontSize, bold: true, color: BROWN }),
                   { align: AlignmentType.CENTER, spacing: { before: 80, after: 80 } }),
              { shading: { type: ShadingType.SOLID, color: LIGHT_BG }, margins: cellPadding, width: { size: colWidths[ci], type: WidthType.PERCENTAGE } }
            );
          })
        }));
        
        if (Array.isArray(block.rows)) {
          for (const row of block.rows) {
            if (!Array.isArray(row)) continue;
            if (!isRowMeaningful(row, 0)) continue;
            const isTotal = String(row[0] || "").toLowerCase().includes("total");
            tableRows.push(new TableRow({
              children: row.map((val, colIdx) => {
                let formatted;
                if (colIdx === 0) {
                  formatted = fullClean(val || "") || "—";
                } else {
                  formatted = formatCellValue(val);
                }
                const isNumeric = colIdx > 0 && (isNumericString(val) || formatted === "—" || formatted.startsWith("("));
                return cell(
                  para(txt(formatted, { font: "Times New Roman", size: fontSize, bold: isTotal }), { align: isNumeric ? AlignmentType.RIGHT : AlignmentType.LEFT, spacing: { before: 50, after: 50 } }),
                  { 
                    margins: cellPadding,
                    width: { size: colWidths[colIdx] || otherColPct, type: WidthType.PERCENTAGE },
                    ...(isTotal ? { shading: { type: ShadingType.SOLID, color: "FAF7F2" } } : {})
                  }
                );
              })
            }));
          }
        }
        if (tableRows.length > 1) {
          allSections.push(new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
          allSections.push(blankLine());
        }
      } else if (block.type === "page_break") {
        allSections.push(pageBreak());
      }
    }
  }

  // CHARTS SECTION
  if (chartImages && chartImages.length > 0) {
    allSections.push(pageBreak());
    allSections.push(sectionHeader("[600100]", "Financial Performance Charts"));
    allSections.push(para(
      [txt("Visual representation of key financial metrics extracted from the financial statements.", { font: "Times New Roman", size: 22, italics: true })],
      { align: AlignmentType.JUSTIFIED, spacing: { before: 120, after: 240 } }
    ));
    for (const chart of chartImages) {
      try {
        const imgBytes = dataURLToUint8Array(chart.dataURL);
        allSections.push(para(
          [txt(chart.caption || "", { font: "Times New Roman", size: 22, bold: true, color: BROWN })],
          { align: AlignmentType.CENTER, spacing: { before: 200, after: 100 } }
        ));
        allSections.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({ data: imgBytes, transformation: { width: 600, height: 343 } })],
          spacing: { before: 100, after: 200 }
        }));
      } catch (chartErr) { console.error("Chart embedding failed:", chartErr); }
    }
  }

  // RATIOS SECTION
  if (ratios && ratios.length > 0) {
    allSections.push(pageBreak());
    allSections.push(sectionHeader("[500100]", "Financial Ratios Analysis"));
    allSections.push(disclaimer(companyInfo.rounding));
    allSections.push(para(
      [txt("The following ratios have been calculated from the financial data extracted from this document. Ratios marked with em-dash (—) indicate insufficient data in the source document for calculation.", { font: "Times New Roman", size: 22, italics: true })],
      { align: AlignmentType.JUSTIFIED, spacing: { before: 120, after: 240 } }
    ));
    for (const category of ratios) {
      allSections.push(subheading(category.category));
      const ratioRows = [];
      ratioRows.push(new TableRow({
        tableHeader: true,
        children: [
          cell(para(txt("Ratio", { font: "Times New Roman", size: 20, bold: true, color: BROWN }), { spacing: { before: 100, after: 100 } }), { shading: { type: ShadingType.SOLID, color: LIGHT_BG }, width: { size: 28, type: WidthType.PERCENTAGE } }),
          cell(para(txt("Value", { font: "Times New Roman", size: 20, bold: true, color: BROWN }), { align: AlignmentType.CENTER, spacing: { before: 100, after: 100 } }), { shading: { type: ShadingType.SOLID, color: LIGHT_BG }, width: { size: 15, type: WidthType.PERCENTAGE } }),
          cell(para(txt("Formula", { font: "Times New Roman", size: 20, bold: true, color: BROWN }), { spacing: { before: 100, after: 100 } }), { shading: { type: ShadingType.SOLID, color: LIGHT_BG }, width: { size: 27, type: WidthType.PERCENTAGE } }),
          cell(para(txt("Interpretation", { font: "Times New Roman", size: 20, bold: true, color: BROWN }), { spacing: { before: 100, after: 100 } }), { shading: { type: ShadingType.SOLID, color: LIGHT_BG }, width: { size: 30, type: WidthType.PERCENTAGE } })
        ]
      }));
      for (const item of category.items) {
        ratioRows.push(new TableRow({
          children: [
            cell(para(txt(item.name, { font: "Times New Roman", size: 20, bold: true }), { spacing: { before: 80, after: 80 } })),
            cell(para(txt(item.value, { font: "Times New Roman", size: 20, bold: true, color: item.value === "—" ? "999999" : BROWN }), { align: AlignmentType.CENTER, spacing: { before: 80, after: 80 } })),
            cell(para(txt(item.formula, { font: "Times New Roman", size: 18, italics: true, color: "555555" }), { spacing: { before: 80, after: 80 } })),
            cell(para(txt(item.interpretation, { font: "Times New Roman", size: 18, color: "444444" }), { spacing: { before: 80, after: 80 } }))
          ]
        }));
      }
      allSections.push(new Table({ rows: ratioRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
      allSections.push(blankLine());
    }
  }

  // SWOT SECTION
  if (swot) {
    allSections.push(pageBreak());
    allSections.push(sectionHeader("[700100]", "SWOT Analysis"));
    allSections.push(disclaimer(companyInfo.rounding));
    allSections.push(para(
      [txt(`Company-specific SWOT analysis for ${companyInfo.name || "the Company"} based on extracted financial data.`, { font: "Times New Roman", size: 22, italics: true })],
      { align: AlignmentType.JUSTIFIED, spacing: { before: 120, after: 240 } }
    ));
    const swotCell = (title, items, color, bgColor) => {
      const children = [];
      children.push(para([txt(title, { font: "Times New Roman", size: 24, bold: true, color: color })], { align: AlignmentType.CENTER, spacing: { before: 150, after: 200 } }));
      if (items && items.length > 0) {
        for (const item of items) {
          if (!item || !item.trim()) continue;
          children.push(para(
            [txt("• ", { font: "Times New Roman", size: 22, bold: true, color: color }), txt(item.trim(), { font: "Times New Roman", size: 21 })],
            { spacing: { before: 100, after: 100, line: 320 }, indent: { left: 240, hanging: 180 } }
          ));
        }
      } else children.push(para([txt("No data available", { font: "Times New Roman", size: 20, italics: true, color: "999999" })], { align: AlignmentType.CENTER }));
      return new TableCell({
        children, borders: cellBorder, shading: { type: ShadingType.SOLID, color: bgColor },
        margins: { top: 200, bottom: 200, left: 200, right: 200 },
        width: { size: 50, type: WidthType.PERCENTAGE }, verticalAlign: "top"
      });
    };
    allSections.push(new Table({
      rows: [
        new TableRow({ children: [
          swotCell("STRENGTHS", swot.strengths || [], "2D7D5C", "F0FAF5"),
          swotCell("WEAKNESSES", swot.weaknesses || [], "C04040", "FDF2F2"),
        ]}),
        new TableRow({ children: [
          swotCell("OPPORTUNITIES", swot.opportunities || [], "3B82B0", "F0F6FC"),
          swotCell("THREATS", swot.threats || [], "A8761F", "FEF7E6"),
        ]})
      ],
      width: { size: 100, type: WidthType.PERCENTAGE }
    }));
    allSections.push(blankLine());
    if (swot.ratioInterpretations && swot.ratioInterpretations.length > 0) {
      allSections.push(pageBreak());
      allSections.push(subSectionHeader("Company-Specific Ratio Interpretations"));
      allSections.push(para(
        [txt(`What each ratio means specifically for ${companyInfo.name || "the Company"}.`, { font: "Times New Roman", size: 22, italics: true })],
        { align: AlignmentType.JUSTIFIED, spacing: { before: 120, after: 240 } }
      ));
      const interpRows = [];
      interpRows.push(new TableRow({
        tableHeader: true,
        children: [
          cell(para(txt("Ratio", { font: "Times New Roman", size: 20, bold: true, color: BROWN }), { spacing: { before: 100, after: 100 } }), { shading: { type: ShadingType.SOLID, color: LIGHT_BG }, width: { size: 25, type: WidthType.PERCENTAGE } }),
          cell(para(txt("Value", { font: "Times New Roman", size: 20, bold: true, color: BROWN }), { align: AlignmentType.CENTER, spacing: { before: 100, after: 100 } }), { shading: { type: ShadingType.SOLID, color: LIGHT_BG }, width: { size: 15, type: WidthType.PERCENTAGE } }),
          cell(para(txt(`What This Means for ${companyInfo.name || "the Company"}`, { font: "Times New Roman", size: 20, bold: true, color: BROWN }), { spacing: { before: 100, after: 100 } }), { shading: { type: ShadingType.SOLID, color: LIGHT_BG }, width: { size: 60, type: WidthType.PERCENTAGE } })
        ]
      }));
      for (const interp of swot.ratioInterpretations) {
        interpRows.push(new TableRow({
          children: [
            cell(para(txt(interp.ratio || "—", { font: "Times New Roman", size: 20, bold: true }), { spacing: { before: 100, after: 100 } })),
            cell(para(txt(interp.value || "—", { font: "Times New Roman", size: 20, bold: true, color: BROWN }), { align: AlignmentType.CENTER, spacing: { before: 100, after: 100 } })),
            cell(para(txt(interp.meaning || "—", { font: "Times New Roman", size: 20 }), { align: AlignmentType.JUSTIFIED, spacing: { before: 100, after: 100, line: 320 } }))
          ]
        }));
      }
      allSections.push(new Table({ rows: interpRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    }
  }

  // FOOTER
  allSections.push(pageBreak());
  allSections.push(para(
    [txt(`Generated by FinSight AI · by ${AUTHOR_NAME} · finsightai.org`, { font: "Times New Roman", size: 20, italics: true, color: "888888" })],
    { align: AlignmentType.CENTER, spacing: { before: 400, after: 100 } }
  ));
  allSections.push(para(
    [txt(`This document is for informational purposes only and does not constitute investment advice.`, { font: "Times New Roman", size: 18, italics: true, color: "999999" })],
    { align: AlignmentType.CENTER, spacing: { before: 100, after: 100 } }
  ));

  const docTitle = `${companyInfo.name || "Private Company"} - Organized Financial Statements`;
  const doc = new Document({
    creator: 'FinSight AI',
    title: docTitle,
    description: 'AI-organized financial statements with ratios, SWOT, and charts',
    subject: 'Organized financial statements',
    keywords: 'financial-statements,MCA,XBRL,ratios,SWOT',
    styles: { default: { document: { run: { font: "Times New Roman", size: 22 }, paragraph: { spacing: { line: 320 } } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1200, right: 1200, bottom: 1200, left: 1200, header: 720, footer: 720 },
          borders: {
            pageBorderTop: { style: BorderStyle.SINGLE, size: 12, color: "8B4513", space: 24 },
            pageBorderRight: { style: BorderStyle.SINGLE, size: 12, color: "8B4513", space: 24 },
            pageBorderBottom: { style: BorderStyle.SINGLE, size: 12, color: "8B4513", space: 24 },
            pageBorderLeft: { style: BorderStyle.SINGLE, size: 12, color: "8B4513", space: 24 }
          }
        }
      },
      headers: {
        default: new Header({
          children: [
            para(
              [txt(`${companyInfo.name || "Private Company"}${companyInfo.period ? "    Standalone Financial Statements for period " + preserveDateRanges(companyInfo.period) : ""}`, {
                font: "Times New Roman", size: 18, italics: true, bold: true, color: BROWN
              })],
              { align: AlignmentType.CENTER, spacing: { before: 0, after: 0 } }
            )
          ]
        })
      },
      footers: {
        default: new Footer({
          children: [
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 4, color: "E8E1D8" },
                bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE },
                right: { style: BorderStyle.NONE }, insideH: { style: BorderStyle.NONE },
                insideV: { style: BorderStyle.NONE },
              },
              rows: [new TableRow({
                children: [
                  new TableCell({
                    width: { size: 33, type: WidthType.PERCENTAGE },
                    borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                    children: [new Paragraph({ children: [new TextRun({ text: "FinSight AI", bold: true, size: 16, color: BROWN, font: "Times New Roman" })], spacing: { before: 60, after: 0 } })]
                  }),
                  new TableCell({
                    width: { size: 34, type: WidthType.PERCENTAGE },
                    borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Generated ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`, italics: true, size: 14, color: "9E9890", font: "Times New Roman" })], spacing: { before: 60, after: 0 } })]
                  }),
                  new TableCell({
                    width: { size: 33, type: WidthType.PERCENTAGE },
                    borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                    children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Page ", size: 16, color: "6B6158", font: "Times New Roman" }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "6B6158", font: "Times New Roman" }), new TextRun({ text: " of ", size: 16, color: "6B6158", font: "Times New Roman" }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: "6B6158", font: "Times New Roman" })], spacing: { before: 60, after: 0 } })]
                  }),
                ]
              })]
            })
          ]
        })
      },
      children: allSections
    }]
  });

  const docxBlob = await Packer.toBlob(doc);
  const fileName = generateSmartFilename(companyInfo, 'docx');
  return { docxBlob, fileName };
}

function loadScriptWithTimeout(src, label) {
  return Promise.race([
    new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Failed to load ${label}`));
      document.head.appendChild(s);
    }),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error("PDF library could not be loaded. Please check your internet connection or try again.")),
      30_000
    )),
  ]);
}

async function loadPdfMake() {
  if (window.pdfMake?.vfs) return window.pdfMake;
  await loadScriptWithTimeout('https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/pdfmake.min.js', 'PDF library');
  await loadScriptWithTimeout('https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/vfs_fonts.js', 'PDF fonts');
  return window.pdfMake;
}

async function generateOrganizedPdfDoc(chunkResults, companyInfo, ratios, swot, chartImages) {
  const t0 = Date.now();
  console.log(`[generateOrganizedPdfDoc] START ${new Date().toISOString()} | chunks=${chunkResults.length}`);
  try {
  const pdfMake = await loadPdfMake();
  console.log(`[generateOrganizedPdfDoc] pdfMake loaded at +${Date.now() - t0}ms`);

  // A4 content width: 595.28 - 56 (left) - 56 (right) = 483.28 pt
  const CW = 483;
  const BROWN = '#8B4513';
  const LIGHT_BG = '#F5EFE7';

  const tableLayout = {
    hLineWidth: (i, node) => (i === 0 || i === node.table.body.length) ? 0.75 : 0.4,
    vLineWidth: () => 0.4,
    hLineColor: () => '#AAAAAA',
    vLineColor: () => '#AAAAAA',
    paddingLeft: (i) => i === 0 ? 5 : 4,
    paddingRight: (i, node) => i === node.table.widths.length - 1 ? 5 : 4,
    paddingTop: () => 3,
    paddingBottom: () => 3,
  };

  const content = [];

  const addDisclaimer = () => content.push({
    text: `Unless otherwise specified, all monetary values are in ${companyInfo.rounding || 'Lakhs'} of INR`,
    fontSize: 9, italics: true, color: BROWN, alignment: 'right', margin: [0, 3, 0, 6]
  });

  // ── TITLE PAGE ──────────────────────────────────────────────────────────────
  content.push({ text: '', margin: [0, 160, 0, 0] });
  content.push({
    text: companyInfo.name || 'PRIVATE COMPANY',
    fontSize: 28, bold: true, color: BROWN, alignment: 'center', margin: [0, 0, 0, 18]
  });
  if (companyInfo.period) {
    content.push({ text: 'Standalone Financial Statements', fontSize: 14, italics: true, color: '#3C3C3C', alignment: 'center', margin: [0, 0, 0, 8] });
    content.push({ text: ['for the period ', { text: companyInfo.period, noWrap: true }], fontSize: 12, italics: true, color: '#5A5A5A', alignment: 'center', margin: [0, 0, 0, 24] });
  }
  addDisclaimer();

  // ── MAIN CONTENT SECTIONS ───────────────────────────────────────────────────
  const seenHeadings = new Set();
  const headingKey = (num, title) => `${(num || '').toLowerCase()}::${humanizeTitle(title || '').toLowerCase()}`;
  let currentSectionTitle = '';

  const pushSectionHeader = (num, title) => {
    content.push({
      text: `${num ? num + ' ' : ''}${humanizeTitle(title)}`,
      fontSize: 16, bold: true, color: BROWN, alignment: 'center',
      pageBreak: 'before', margin: [0, 0, 0, 6]
    });
    addDisclaimer();
    content.push({ text: '', margin: [0, 4, 0, 0] });
  };

  for (const chunkResult of chunkResults) {
    if (!chunkResult.blocks || chunkResult.blocks.length === 0) continue;
    const newSection = chunkResult.sectionTitle || '';
    if (newSection && newSection !== currentSectionTitle) {
      const key = headingKey(chunkResult.sectionNumber, newSection);
      if (!seenHeadings.has(key)) {
        seenHeadings.add(key);
        pushSectionHeader(chunkResult.sectionNumber, newSection);
        currentSectionTitle = newSection;
      }
    }

    for (const block of chunkResult.blocks) {
      if (block.type === 'section_break') {
        const key = headingKey(block.sectionNumber, block.title);
        if (seenHeadings.has(key)) continue;
        seenHeadings.add(key);
        pushSectionHeader(block.sectionNumber || '', block.title || '');
        currentSectionTitle = block.title || currentSectionTitle;

      } else if (block.type === 'heading') {
        content.push({ text: humanizeTitle(block.title || ''), fontSize: 13, bold: true, color: BROWN, margin: [0, 14, 0, 4] });

      } else if (block.type === 'subheading') {
        content.push({ text: humanizeTitle(block.title || ''), fontSize: 11, bold: true, color: BROWN, margin: [0, 8, 0, 3] });

      } else if (block.type === 'paragraph_block') {
        if (block.title) content.push({ text: humanizeTitle(block.title), fontSize: 11, bold: true, color: BROWN, margin: [0, 8, 0, 3] });
        const paragraphs = Array.isArray(block.paragraphs)
          ? block.paragraphs
          : (block.content ? splitNarrativeIntoParagraphs(block.content) : []);
        for (const p of paragraphs) {
          if (!p || !p.trim()) continue;
          const cleanP = fullClean(p.trim());
          if (!cleanP) continue;
          content.push({ text: cleanP, fontSize: 11, alignment: 'justify', lineHeight: 1.4, margin: [0, 0, 0, 6] });
        }

      } else if (block.type === 'bullet_list' && Array.isArray(block.items)) {
        if (block.title) content.push({ text: humanizeTitle(block.title), fontSize: 11, bold: true, color: BROWN, margin: [0, 8, 0, 3] });
        for (const item of block.items) {
          if (!item || !item.trim()) continue;
          const clean = fullClean(item.trim());
          if (!clean) continue;
          content.push({ text: `•  ${clean}`, fontSize: 11, lineHeight: 1.4, margin: [14, 1, 0, 1] });
        }

      } else if (block.type === 'key_value_table' && block.pairs && block.pairs.length > 0) {
        if (block.title) content.push({ text: humanizeTitle(block.title), fontSize: 11, bold: true, color: BROWN, margin: [0, 8, 0, 3] });
        const rows = block.pairs
          .filter(p => p && p.label)
          .map(p => [
            { text: fullClean(p.label) || '', bold: true, fontSize: 10 },
            { text: p.value == null ? '—' : fullClean(String(p.value)) || '—', fontSize: 10 }
          ]);
        if (rows.length > 0) {
          content.push({ table: { widths: [CW * 0.42, CW * 0.58], body: rows }, layout: tableLayout, margin: [0, 4, 0, 10] });
        }

      } else if (block.type === 'table' && block.headers && block.headers.length > 0) {
        if (block.title) content.push({ text: humanizeTitle(block.title), fontSize: 11, bold: true, color: BROWN, margin: [0, 8, 0, 3] });
        const numCols = block.headers.length;
        const isWide = numCols >= 5;
        const fs = isWide ? 8 : 10;
        const pad = isWide ? 2 : 3;
        const firstW = isWide ? CW * 0.24 : CW * 0.34;
        const restW = (CW - firstW) / Math.max(1, numCols - 1);
        const widths = [firstW, ...Array(numCols - 1).fill(restW)];

        const headerRow = block.headers.map(h => ({
          text: fullClean(String(h || '')), bold: true, color: BROWN, fillColor: LIGHT_BG,
          fontSize: fs, alignment: 'center', margin: [pad, pad, pad, pad]
        }));

        const bodyRows = (Array.isArray(block.rows) ? block.rows : [])
          .filter(row => Array.isArray(row) && isRowMeaningful(row, 0))
          .map(row => {
            const isTotal = String(row[0] || '').toLowerCase().includes('total');
            return row.map((val, ci) => ({
              text: ci === 0 ? fullClean(val || '') || '—' : formatCellValue(val),
              fontSize: fs, bold: isTotal,
              fillColor: isTotal ? '#FAF7F2' : null,
              alignment: ci > 0 ? 'right' : 'left',
              margin: [pad, pad, pad, pad]
            }));
          });

        if (bodyRows.length > 0) {
          content.push({ table: { widths, headerRows: 1, body: [headerRow, ...bodyRows] }, layout: tableLayout, margin: [0, 4, 0, 10] });
        }

      } else if (block.type === 'page_break') {
        content.push({ text: '', pageBreak: 'after' });
      }
    }
  }

  // ── CHARTS ──────────────────────────────────────────────────────────────────
  if (chartImages && chartImages.length > 0) {
    content.push({
      text: 'Financial Performance Charts',
      fontSize: 16, bold: true, color: BROWN, alignment: 'center', pageBreak: 'before', margin: [0, 0, 0, 6]
    });
    content.push({ text: 'Visual representation of key financial metrics extracted from the financial statements.', fontSize: 10, italics: true, alignment: 'justify', margin: [0, 0, 0, 14] });
    for (const chart of chartImages) {
      try {
        if (chart.caption) content.push({ text: chart.caption, fontSize: 11, bold: true, italics: true, color: BROWN, alignment: 'center', margin: [0, 10, 0, 4] });
        content.push({ image: chart.dataURL, width: CW, alignment: 'center', margin: [0, 0, 0, 18] });
      } catch (e) { console.error('Chart embed failed:', e); }
    }
  }

  // ── RATIOS ──────────────────────────────────────────────────────────────────
  if (ratios && ratios.length > 0) {
    content.push({ text: 'Financial Ratios Analysis', fontSize: 16, bold: true, color: BROWN, alignment: 'center', pageBreak: 'before', margin: [0, 0, 0, 4] });
    addDisclaimer();
    content.push({ text: 'Ratios marked with — indicate insufficient data in the source document for calculation.', fontSize: 9.5, italics: true, margin: [0, 0, 0, 10] });
    for (const category of ratios) {
      content.push({ text: humanizeTitle(category.category), fontSize: 11, bold: true, color: BROWN, margin: [0, 10, 0, 4] });
      const hRow = ['Ratio', 'Value', 'Formula', 'Interpretation'].map(h => ({
        text: h, bold: true, color: BROWN, fillColor: LIGHT_BG, fontSize: 9, margin: [3, 3, 3, 3]
      }));
      const bRows = category.items.map(it => [
        { text: it.name, bold: true, fontSize: 9, margin: [3, 3, 3, 3] },
        { text: it.value, fontSize: 9, alignment: 'center', color: it.value === '—' ? '#AAAAAA' : '#000000', margin: [3, 3, 3, 3] },
        { text: it.formula, italics: true, fontSize: 9, color: '#555555', margin: [3, 3, 3, 3] },
        { text: it.interpretation, fontSize: 9, color: '#444444', margin: [3, 3, 3, 3] }
      ]);
      content.push({ table: { widths: [CW * 0.22, CW * 0.12, CW * 0.27, CW * 0.39], headerRows: 1, body: [hRow, ...bRows] }, layout: tableLayout, margin: [0, 0, 0, 10] });
    }
  }

  // ── SWOT ─────────────────────────────────────────────────────────────────────
  if (swot) {
    content.push({ text: 'SWOT Analysis', fontSize: 16, bold: true, color: BROWN, alignment: 'center', pageBreak: 'before', margin: [0, 0, 0, 4] });
    addDisclaimer();
    content.push({ text: `Company-specific SWOT analysis for ${companyInfo.name || 'the Company'} based on extracted financial data.`, fontSize: 10, italics: true, alignment: 'justify', margin: [0, 0, 0, 12] });

    const swotCell = (label, items, textColor, fillColor) => ({
      fillColor,
      stack: [
        { text: label, bold: true, fontSize: 13, color: textColor, alignment: 'center', margin: [0, 4, 0, 8] },
        ...(items && items.length > 0
          ? items.map(s => ({ text: `•  ${s.trim()}`, fontSize: 10, color: textColor, lineHeight: 1.4, margin: [8, 1, 0, 1] }))
          : [{ text: 'No data available', fontSize: 10, italics: true, color: '#999999', alignment: 'center' }])
      ],
      margin: [6, 6, 6, 6]
    });

    content.push({
      table: {
        widths: [CW / 2, CW / 2],
        body: [
          [swotCell('STRENGTHS', swot.strengths, '#2D7D5C', '#F0FAF5'), swotCell('WEAKNESSES', swot.weaknesses, '#C04040', '#FDF2F2')],
          [swotCell('OPPORTUNITIES', swot.opportunities, '#3B82B0', '#F0F6FC'), swotCell('THREATS', swot.threats, '#A8761F', '#FEF7E6')]
        ]
      },
      layout: tableLayout,
      margin: [0, 0, 0, 14]
    });

    if (swot.ratioInterpretations && swot.ratioInterpretations.length > 0) {
      content.push({ text: 'Company-Specific Ratio Interpretations', fontSize: 13, bold: true, color: BROWN, pageBreak: 'before', margin: [0, 0, 0, 4] });
      content.push({ text: `What each ratio means specifically for ${companyInfo.name || 'the Company'}.`, fontSize: 10, italics: true, margin: [0, 0, 0, 10] });
      const hRow = ['Ratio', 'Value', `What This Means for ${companyInfo.name || 'the Company'}`].map(h => ({
        text: h, bold: true, color: BROWN, fillColor: LIGHT_BG, fontSize: 9, margin: [3, 3, 3, 3]
      }));
      const bRows = swot.ratioInterpretations.map(it => [
        { text: it.ratio || '—', bold: true, fontSize: 9, margin: [3, 3, 3, 3] },
        { text: it.value || '—', fontSize: 9, alignment: 'center', margin: [3, 3, 3, 3] },
        { text: it.meaning || '—', fontSize: 9, margin: [3, 3, 3, 3] }
      ]);
      content.push({ table: { widths: [CW * 0.22, CW * 0.12, CW * 0.66], headerRows: 1, body: [hRow, ...bRows] }, layout: tableLayout, margin: [0, 0, 0, 10] });
    }
  }

  // ── CLOSING PAGE ─────────────────────────────────────────────────────────────
  content.push({ text: '', pageBreak: 'before' });
  content.push({ text: `Generated by FinSight AI · by ${AUTHOR_NAME} · finsightai.org`, fontSize: 10, italics: true, color: '#888888', alignment: 'center', margin: [0, 240, 0, 0] });
  content.push({ text: 'This document is for informational purposes only and does not constitute investment advice.', fontSize: 9, italics: true, color: '#999999', alignment: 'center', margin: [0, 14, 0, 0] });

  // ── DOCUMENT DEFINITION ──────────────────────────────────────────────────────
  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [56, 72, 56, 56],
    background: (currentPage, pageSize) => ({
      canvas: [{
        type: 'rect',
        x: 18, y: 18,
        w: pageSize.width - 36, h: pageSize.height - 36,
        lineColor: '#8B4513',
        lineWidth: 2
      }]
    }),
    header: (currentPage) => {
      if (currentPage === 1) return null;
      return {
        text: companyInfo.period
          ? [{ text: companyInfo.name || 'Private Company' }, { text: '   ·   ' + companyInfo.period, noWrap: true }]
          : (companyInfo.name || 'Private Company'),
        alignment: 'center', italics: true, bold: true,
        color: BROWN, fontSize: 8,
        margin: [56, 18, 56, 0]
      };
    },
    footer: (currentPage, pageCount) => ({
      margin: [56, 8, 56, 18],
      table: {
        widths: ['*', 'auto', '*'],
        body: [[
          { text: 'FinSight AI', fontSize: 9, bold: true, color: '#8B4513', alignment: 'left', border: [false, false, false, false] },
          { text: `Generated ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`, fontSize: 8, italics: true, color: '#9E9890', alignment: 'center', border: [false, false, false, false] },
          { text: `Page ${currentPage} of ${pageCount}`, fontSize: 9, color: '#6B6158', alignment: 'right', border: [false, false, false, false] },
        ]]
      },
      layout: { hLineWidth: (i) => i === 0 ? 0.5 : 0, vLineWidth: () => 0, hLineColor: () => '#E8E1D8' }
    }),
    info: {
      title: `${companyInfo.name || 'Private Company'} - Organized Financial Statements`,
      author: 'FinSight AI',
      subject: 'AI-organized financial statements with ratios, SWOT, and charts',
      keywords: 'financial statements, MCA, XBRL, Companies Act, ratios, SWOT analysis, India, private company',
      creator: 'FinSight AI · finsightai.org',
      producer: 'FinSight AI · pdfMake',
    },
    ownerPassword: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
    permissions: {
      printing: 'highResolution',
      modifying: false,
      copying: true,
      annotating: false,
      fillingForms: false,
      contentAccessibility: true,
      documentAssembly: false,
    },
    defaultStyle: { font: 'Roboto', fontSize: 11, lineHeight: 1.4, color: '#000000' },
    content,
  };

  const ratioCount = ratios ? ratios.reduce((sum, cat) => sum + (cat.items?.length || 0), 0) : 0;
  const sectionCount = chunkResults.length;
  const hasSWOT = !!swot && !!(swot.strengths?.length || swot.weaknesses?.length || swot.opportunities?.length || swot.threats?.length);
  const hasCharts = chartImages.length > 0;
  const fileName = generateSmartFilename(companyInfo, 'pdf');
  console.log(`[generateOrganizedPdfDoc] calling createPdf at +${Date.now() - t0}ms | content items=${content.length}`);
  const pdfBlob = await new Promise((resolve) => pdfMake.createPdf(docDefinition).getBlob(resolve));
  const fileSizeKB = Math.round(pdfBlob.size / 1024);
  console.log(`[generateOrganizedPdfDoc] DONE at +${Date.now() - t0}ms | size=${fileSizeKB}KB`);
  return { pdfBlob, fileName, fileSizeKB, sectionCount, ratioCount, hasSWOT, hasCharts };
  } catch (pdfErr) {
    console.error(`[generateOrganizedPdfDoc] FAILED at +${Date.now() - t0}ms:`, pdfErr);
    throw new Error(`PDF generation failed: ${pdfErr.message}`);
  }
}

async function processPrivateCompanyDoc(file, onProgress) {
  try {
    onProgress?.("Reading your document...");
    const isPdf = file.name.match(/\.pdf$/i);
    const extractedText = isPdf ? await extractPdfContent(file) : await extractWordContent(file);
    if (!extractedText || extractedText.trim().length < 100) {
      throw new Error("Document appears to be empty or unreadable.");
    }
    onProgress?.("Splitting document into sections...");
    const chunks = chunkText(extractedText, 12000, 500);
    onProgress?.(`Document has ${chunks.length} sections. Beginning AI processing (may take 3-5 minutes)...`);
    const chunkResults = [];
    let companyInfo = { name: "", period: "", rounding: "Lakhs", currency: "INR", sector: "" };
    const loopStart = Date.now();
    const chunkTimes = [];
    let failedChunks = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunkStart = Date.now();
      let chunkResult;
      try {
        chunkResult = await processChunkWithAI(
          chunks[i], i + 1, chunks.length,
          i > 0 ? `Company: ${companyInfo.name || "unknown"}, Period: ${companyInfo.period || "unknown"}, Sector: ${companyInfo.sector || "unknown"}` : null,
          onProgress
        );
      } catch (chunkErr) {
        failedChunks++;
        console.error(`[processPrivateCompanyDoc] Chunk ${i + 1}/${chunks.length} failed:`, chunkErr);
        chunkResult = {
          chunkSummary: `Section ${i + 1} failed to process`,
          sectionNumber: "",
          sectionTitle: `Section ${i + 1} (Failed)`,
          blocks: [{
            type: "paragraph_block",
            paragraphs: [
              "This section could not be processed automatically due to a technical issue. The original content has been preserved below for manual review.",
              chunks[i].substring(0, 5000) + "..."
            ]
          }],
          companyInfoFound: {},
          financialDataExtracted: {}
        };
      }
      const chunkSecs = Math.round((Date.now() - chunkStart) / 1000);
      chunkTimes.push(chunkSecs);
      chunkResults.push(chunkResult);
      if (chunkResult.companyInfoFound) {
        const ci = chunkResult.companyInfoFound;
        if (ci.name && !companyInfo.name) companyInfo.name = ci.name;
        if (ci.period && !companyInfo.period) companyInfo.period = ci.period;
        if (ci.rounding) companyInfo.rounding = ci.rounding;
        if (ci.currency) companyInfo.currency = ci.currency;
        if (ci.sector && !companyInfo.sector) companyInfo.sector = ci.sector;
      }
      if (i < chunks.length - 1) {
        onProgress?.(`Processed section ${i + 1} of ${chunks.length} (took ${chunkSecs}s). Waiting briefly before next...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    const totalSecs = Math.round((Date.now() - loopStart) / 1000);
    const avgSecs = Math.round(chunkTimes.reduce((a, b) => a + b, 0) / chunkTimes.length);
    const slowestSecs = Math.max(...chunkTimes);
    console.log(`[processPrivateCompanyDoc] Total: ${totalSecs}s | Avg chunk: ${avgSecs}s | Slowest chunk: ${slowestSecs}s | Failed: ${failedChunks}`);
    if (failedChunks > 0) {
      chunkResults.unshift({
        chunkSummary: "Processing notice",
        sectionNumber: "",
        sectionTitle: "Processing Notice",
        blocks: [{
          type: "paragraph_block",
          paragraphs: [
            `NOTE: ${failedChunks} of ${chunks.length} sections required manual processing. The original content for those sections is preserved verbatim in the document.`
          ]
        }],
        companyInfoFound: {},
        financialDataExtracted: {}
      });
    }
    const successChunks = chunks.length - failedChunks;
    const progressSuffix = failedChunks > 0
      ? `Done: ${successChunks} sections processed, ${failedChunks} needed fallback. Generating PDF...`
      : "Calculating financial ratios...";
    onProgress?.(progressSuffix);
    const aggregated = aggregateFinancialData(chunkResults);
    let sectorHint = companyInfo.sector || "";
    if (!sectorHint) {
      const nameLower = (companyInfo.name || "").toLowerCase();
      if (nameLower.includes("medical") || nameLower.includes("pharma") || nameLower.includes("health")) sectorHint = "medical";
      else if (nameLower.includes("steel") || nameLower.includes("manufact")) sectorHint = "manufacturing";
    }
    const ratios = calculateRatios(aggregated, sectorHint);
    const swot = await generateSWOTAndInterpretation(companyInfo, aggregated, ratios, onProgress);
    
    onProgress?.("Building bar charts...");
    const chartImages = [];
    if (aggregated.revenue || aggregated.netIncome || aggregated.operatingProfit || aggregated.ebitda) {
      try {
        const dataURL = createFinancialBarChart({
          title: "Key Financial Performance",
          subtitle: `${companyInfo.name || "Company"} • Values in ${companyInfo.rounding || "Lakhs"} of INR`,
          labels: ["Revenue", "Gross Profit", "EBITDA", "Operating Profit", "Net Income"],
          values: [aggregated.revenue, aggregated.grossProfit, aggregated.ebitda, aggregated.operatingProfit, aggregated.netIncome],
          colors: ["#CF6B4E", "#2D7D5C", "#3B82B0", "#7C5CB8", "#D9A441"],
          unit: companyInfo.rounding || "Lakhs of INR"
        });
        chartImages.push({ dataURL, caption: "Chart 1: Key Financial Performance Metrics" });
      } catch (e) { console.error("Chart 1 failed:", e); }
    }
    if (aggregated.totalAssets || aggregated.totalEquity || aggregated.totalLiabilities || aggregated.currentAssets) {
      try {
        const dataURL = createFinancialBarChart({
          title: "Balance Sheet Composition",
          subtitle: `${companyInfo.name || "Company"} • Values in ${companyInfo.rounding || "Lakhs"} of INR`,
          labels: ["Total Assets", "Current Assets", "Fixed Assets", "Total Equity", "Total Liabilities"],
          values: [aggregated.totalAssets, aggregated.currentAssets, aggregated.fixedAssets, aggregated.totalEquity, aggregated.totalLiabilities],
          colors: ["#8B6F47", "#D9A441", "#CF6B4E", "#2D7D5C", "#C04040"],
          unit: companyInfo.rounding || "Lakhs of INR"
        });
        chartImages.push({ dataURL, caption: "Chart 2: Balance Sheet Composition" });
      } catch (e) { console.error("Chart 2 failed:", e); }
    }
    const profitabilityRatios = ratios.find(r => r.category === "Profitability Ratios");
    if (profitabilityRatios) {
      try {
        const validItems = profitabilityRatios.items.filter(i => i.rawValue != null && !isNaN(i.rawValue));
        if (validItems.length > 0) {
          const dataURL = createFinancialBarChart({
            title: "Profitability Ratios (%)",
            subtitle: `${companyInfo.name || "Company"} • Values in Percentage`,
            labels: validItems.map(i => i.name.replace(" (ROE)", "").replace(" (ROA)", "")),
            values: validItems.map(i => i.rawValue),
            colors: ["#CF6B4E", "#A8553C", "#D9A441", "#2D7D5C", "#3B82B0"],
            unit: "Percentage (%)"
          });
          chartImages.push({ dataURL, caption: "Chart 3: Profitability Ratio Analysis" });
        }
      } catch (e) { console.error("Chart 3 failed:", e); }
    }
    
    const totalBlocks = chunkResults.reduce((sum, cr) => sum + (cr.blocks?.length || 0), 0);
    if (totalBlocks > 500) {
      console.warn(`[processPrivateCompanyDoc] Large document: ${totalBlocks} blocks — PDF may take 60-180s`);
      onProgress?.(`Large document detected (${totalBlocks} blocks). PDF generation may take 60-180 seconds. Please wait...`);
    } else {
      onProgress?.("Generating your professional PDF document...");
    }

    const pdfStart = Date.now();
    const pdfElapsedInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - pdfStart) / 1000);
      onProgress?.(`Generating PDF... (${elapsed} seconds elapsed)`);
    }, 5000);

    let pdfResult = null;
    let pdfError = null;
    try {
      pdfResult = await Promise.race([
        generateOrganizedPdfDoc(chunkResults, companyInfo, ratios, swot, chartImages),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error("PDF generation timed out. Your data has been organized but the file is too large for browser rendering. Please contact support with your file.")),
          180_000
        )),
      ]);
    } catch (err) {
      pdfError = err;
      console.error("[processPrivateCompanyDoc] PDF failed:", pdfError);
    } finally {
      clearInterval(pdfElapsedInterval);
    }

    onProgress?.("Generating Word document...");
    let docxResult = null;
    try {
      docxResult = await generateOrganizedWordDoc(chunkResults, companyInfo, ratios, swot, chartImages, file.name);
    } catch (wordErr) {
      console.error("[processPrivateCompanyDoc] Word generation failed:", wordErr);
    }

    if (!pdfResult && !docxResult) throw pdfError || new Error("Both PDF and Word generation failed.");

    return {
      pdfBlob: pdfResult?.pdfBlob || null,
      pdfFileName: pdfResult?.fileName || null,
      pdfFileSizeKB: pdfResult?.fileSizeKB || 0,
      docxBlob: docxResult?.docxBlob || null,
      docxFileName: docxResult?.fileName || null,
      companyInfo,
      chunkCount: chunks.length,
      failedChunks,
      sectionCount: pdfResult?.sectionCount || chunkResults.length,
      ratioCount: pdfResult?.ratioCount || 0,
      hasSWOT: pdfResult?.hasSWOT ?? !!swot,
      hasCharts: pdfResult?.hasCharts ?? chartImages.length > 0,
    };
  } catch (error) {
    console.error("Private company doc processing error:", error);
    throw error;
  }
}

async function generatePPTFull(data, periodLabel) {
  const PptxGenJS = await loadPptxGenJS();
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = `FinSight AI - ${data.company}`;
  pptx.author = AUTHOR_NAME;
  const PC = { bgPage: "F9F7F4", bgCard: "FFFFFF", border: "E8E1D8", accent: "CF6B4E", textPrimary: "1F1B18", textSec: "6B6158", textMuted: "9E9890", green: "2D7D5C", red: "C04040" };
  const sym = data.currencySymbol || "$";
  const today = new Date().toISOString().split('T')[0];
  const lastIdx = (data.years?.length || 1) - 1;

  const s1 = pptx.addSlide();
  s1.background = { color: PC.bgPage };
  s1.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.4, fill: { color: PC.accent }, line: { color: PC.accent, width: 0 } });
  s1.addText('FINSIGHT AI', { x: 0.6, y: 1.5, w: 12, h: 0.5, fontSize: 14, fontFace: 'Calibri', bold: true, color: PC.accent });
  s1.addText(data.company || 'Company Analysis', { x: 0.6, y: 2.0, w: 12, h: 1.2, fontSize: 48, fontFace: 'Calibri', bold: true, color: PC.textPrimary });
  s1.addText(`${data.ticker || ''} • ${data.exchange || ''} • ${data.sector || ''}`, { x: 0.6, y: 3.3, w: 12, h: 0.4, fontSize: 16, fontFace: 'Calibri', color: PC.textSec });
  s1.addText(`Financial Analysis Report  •  ${periodLabel}`, { x: 0.6, y: 4.2, w: 12, h: 0.4, fontSize: 18, fontFace: 'Calibri', color: PC.textPrimary });
  s1.addText(`Generated: ${today}`, { x: 0.6, y: 4.7, w: 12, h: 0.3, fontSize: 12, fontFace: 'Calibri', color: PC.textMuted });
  s1.addText(`by ${AUTHOR_NAME}`, { x: 0.6, y: 7.0, w: 12, h: 0.3, fontSize: 11, fontFace: 'Calibri', italic: true, color: PC.textMuted });

  const s2 = pptx.addSlide();
  s2.background = { color: PC.bgCard };
  s2.addText('KEY METRICS', { x: 0.6, y: 0.5, w: 12, h: 0.5, fontSize: 22, fontFace: 'Calibri', bold: true, color: PC.textPrimary });
  const metrics = [
    { label: 'Revenue', value: fmtMoney(data.revenue?.[lastIdx], sym) },
    { label: 'Net Income', value: fmtMoney(data.netIncome?.[lastIdx], sym) },
    { label: 'EBITDA', value: fmtMoney(data.ebitda?.[lastIdx], sym) },
    { label: 'Market Cap', value: fmtMoney(data.marketCap, sym) },
    { label: 'EPS', value: data.eps?.[lastIdx] != null ? `${sym}${Number(data.eps[lastIdx]).toFixed(2)}` : 'N/A' },
    { label: 'P/E', value: data.peRatio ? `${Number(data.peRatio).toFixed(1)}x` : 'N/A' },
  ];
  metrics.forEach((m, i) => {
    const x = 0.6 + (i % 3) * 4.15, y = 1.7 + Math.floor(i / 3) * 2.6;
    s2.addShape(pptx.ShapeType.rect, { x, y, w: 3.95, h: 2.4, fill: { color: PC.bgPage }, line: { color: PC.border, width: 1 } });
    s2.addText(m.label, { x: x + 0.25, y: y + 0.3, w: 3.45, h: 0.3, fontSize: 11, bold: true, color: PC.textMuted });
    s2.addText(m.value, { x: x + 0.25, y: y + 0.7, w: 3.45, h: 0.9, fontSize: 28, bold: true, color: PC.textPrimary });
  });

  const s3 = pptx.addSlide();
  s3.background = { color: PC.bgPage };
  const outlookColor = data.outlook === 'Positive' ? PC.green : data.outlook === 'Caution' ? PC.red : 'A8761F';
  s3.addText('VERDICT', { x: 0.6, y: 0.8, w: 12, h: 0.5, fontSize: 22, fontFace: 'Calibri', bold: true });
  s3.addText(`${(data.outlook || 'Mixed').toUpperCase()} OUTLOOK`, { x: 0.6, y: 1.8, w: 12.1, h: 0.6, fontSize: 28, bold: true, color: outlookColor, align: 'center' });
  s3.addText(cleanText(data.outlookReason) || '', { x: 1.5, y: 2.6, w: 10.3, h: 1.2, fontSize: 15, color: PC.textSec, align: 'center' });
  s3.addText(`Where finance meets intelligence.  •  by ${AUTHOR_NAME}  •  finsightai.org`, { x: 0.6, y: 7.2, w: 12, h: 0.25, fontSize: 10, color: PC.textMuted, align: 'center' });

  const cleanCompany = (data.company || "Company").replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
  await pptx.writeFile({ fileName: `FinSight_${cleanCompany}_${new Date().toISOString().split('T')[0]}.pptx` });
}

async function generateExcel(data, periodLabel) {
  const XLSX = await loadSheetJS();
  const wb = XLSX.utils.book_new();
  const sym = data.currencySymbol || "$";
  const today = new Date().toISOString().split('T')[0];
  const lastIdx = (data.years?.length || 1) - 1;
  const s1Data = [
    ["FINSIGHT AI — FINANCIAL ANALYSIS REPORT"], [`by ${AUTHOR_NAME}`], [""],
    ["COMPANY OVERVIEW"],
    ["Company", data.company || "N/A"], ["Ticker", data.ticker || "N/A"],
    ["Exchange", data.exchange || "N/A"], ["Sector", data.sector || "N/A"],
    ["Period", periodLabel], [""], ["DESCRIPTION"], [data.description || "N/A"], [""],
    ["KEY METRICS"], ["Metric", "Value"],
    ["Revenue", fmtMoney(data.revenue?.[lastIdx], sym)],
    ["Net Income", fmtMoney(data.netIncome?.[lastIdx], sym)],
    ["EBITDA", fmtMoney(data.ebitda?.[lastIdx], sym)],
    ["Market Cap", fmtMoney(data.marketCap, sym)],
    ["P/E", data.peRatio ? `${Number(data.peRatio).toFixed(1)}x` : "N/A"],
    [""], ["OUTLOOK"], ["Rating", data.outlook || "N/A"], ["Reasoning", data.outlookReason || "N/A"],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(s1Data);
  ws1['!cols'] = [{ wch: 25 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Summary");
  const cleanCompany = (data.company || "Company").replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
  XLSX.writeFile(wb, `FinSight_${cleanCompany}_${today}.xlsx`);
}

function buildSystemPrompt(period) {
  const today = new Date().toISOString().split('T')[0];
  const currentYear = new Date().getFullYear();
  const periodInstructions = {
    latest_quarter: `Return MOST RECENT QUARTER. 1 value each.`,
    half_yearly: `Return LAST 2 QUARTERS. 2 values each.`,
    "1_year": `Return LAST 4 QUARTERS. 4 values each.`,
    "2_year": `Return LAST 2 FISCAL YEARS. 2 values each.`,
    "3_year": `Return LAST 3 FISCAL YEARS. 3 values each.`,
    "5_year": `Return LAST 5 FISCAL YEARS. 5 values each.`,
  };
  return `You are FinSight AI. Today: ${today}.
Indian: FY26 = April 2025 to March 2026. US: ${currentYear} calendar.
PERIOD: ${period}. ${periodInstructions[period] || periodInstructions["1_year"]}

Return ONLY raw JSON. No markdown. No <cite> tags.

{
  "company": "Full Name", "ticker": "SYMBOL", "market": "US or India", "exchange": "NSE/NYSE",
  "currency": "USD or INR", "currencySymbol": "$ or ₹", "sector": "sector",
  "description": "2 sentences", "periodType": "${period}", "dataAsOf": "YYYY-MM-DD",
  "years": [], "revenue": [], "netIncome": [], "ebitda": [], "freeCashFlow": [],
  "grossMargin": [], "netMargin": [], "eps": [],
  "costStructure": [{ "cogsPct": n, "opexPct": n, "taxPct": n, "netProfitPct": n, "otherPct": n }],
  "marketCap": number, "peRatio": number, "revenueCAGR": number,
  "analysisRevenue": ["Para 1", "Para 2", "Para 3"],
  "analysisProfitability": ["Para 1", "Para 2", "Para 3"],
  "analysisCashFlow": ["Para 1", "Para 2", "Para 3"],
  "analysisOutlook": ["Para 1", "Para 2", "Para 3"],
  "keyStrengths": ["s1", "s2", "s3"], "keyRisks": ["r1", "r2", "r3"],
  "outlook": "Positive or Mixed or Caution", "outlookReason": "One sentence"
}

CRITICAL: NO <cite> tags. Clean text only.`;
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
const STEPS = ["Searching financial databases", "Fetching latest financial data", "Analyzing profitability trends", "Computing key financial ratios", "Generating AI insights", "Building your dashboard"];

const FinSightLogo = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="fs-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#E48164"/>
        <stop offset="100%" stopColor="#B85A3A"/>
      </linearGradient>
    </defs>
    <rect width="40" height="40" rx="10" fill="url(#fs-grad)"/>
    <path d="M9 28 L16 22 L23 25 L31 13" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    <circle cx="9" cy="28" r="1.8" fill="white"/>
    <circle cx="16" cy="22" r="1.8" fill="white"/>
    <circle cx="23" cy="25" r="1.8" fill="white"/>
    <circle cx="31" cy="13" r="4.5" fill="white" fillOpacity=".22"/>
    <circle cx="31" cy="13" r="2.4" fill="white"/>
  </svg>
);

const Spinner = () => <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${C.accentLight}`, borderTopColor: C.accent, animation: "fs-spin .8s linear infinite" }} />;

const MetricCard = ({ label, value, sub, accent }) => (
  <div className="fs-card" style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 12px", boxShadow: C.shadow, transition: "all .2s", minWidth: 0 }}>
    <div style={{ color: C.textMuted, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 16, fontWeight: 500, color: accent || C.textPrimary, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    <div style={{ color: C.textMuted, fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>
  </div>
);

const Byline = () => <span style={{ color: C.textMuted, fontSize: 11.5 }}>by <span style={{ fontWeight: 600, color: C.accent }}>{AUTHOR_NAME}</span></span>;

function ChartFrame({ icon, title, subtitle, children }) {
  return (
    <div className="fs-chart-card" style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 16, padding: 22, boxShadow: C.shadow, display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 15, color: C.textPrimary, display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 18 }}>{icon}</span><span>{title}</span>
        </div>
        <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.5 }}>{subtitle}</div>
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function GrowthQualityChart({ data, sym }) {
  const hasData = data.revenue?.some(v => v != null);
  if (!hasData) return null;
  const chartData = data.years.map((y, i) => ({ year: String(y), Revenue: data.revenue?.[i], "Gross Margin": data.grossMargin?.[i], "Net Margin": data.netMargin?.[i] }));
  const dataLen = chartData.length;
  return (
    <ChartFrame icon="📊" title="Growth Quality" subtitle="Revenue (bars) plotted against profit margins (lines).">
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={chartData} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
          <defs><linearGradient id="gqBar" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.chartA} stopOpacity={.9}/><stop offset="100%" stopColor={C.chartA} stopOpacity={.45}/></linearGradient></defs>
          <CartesianGrid strokeDasharray="4 4" stroke={C.border} />
          <XAxis dataKey="year" tick={{ fontSize: 11, fill: C.textMuted }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="left" tick={{ fontSize: 11, fill: C.textMuted }} axisLine={false} tickLine={false} tickFormatter={v => fmtMoney(v, "")} width={44} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: C.textMuted }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} width={40} />
          <Tooltip content={<ChartTip sym={sym} />} />
          <Legend wrapperStyle={{ fontSize: 11.5, color: C.textSec, paddingTop: 8 }} />
          <Bar yAxisId="left" dataKey="Revenue" fill="url(#gqBar)" radius={[6, 6, 0, 0]} barSize={dataLen <= 2 ? 60 : dataLen <= 4 ? 40 : 28} />
          <Line yAxisId="right" type="monotone" dataKey="Gross Margin" stroke={C.chartC} strokeWidth={2.6} dot={{ fill: C.chartC, r: 4 }} />
          <Line yAxisId="right" type="monotone" dataKey="Net Margin" stroke={C.chartD} strokeWidth={2.6} dot={{ fill: C.chartD, r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function CashQualityChart({ data, sym }) {
  const hasData = data.netIncome?.some(v => v != null) && data.freeCashFlow?.some(v => v != null);
  if (!hasData) return null;
  const chartData = data.years.map((y, i) => ({ year: String(y), "Net Income": data.netIncome?.[i], "Free Cash Flow": data.freeCashFlow?.[i] }));
  const dataLen = chartData.length;
  return (
    <ChartFrame icon="💰" title="Cash Quality Check" subtitle="Compares reported profits with actual cash generated.">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} barGap={6} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="cqNI" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.chartB} stopOpacity={.9}/><stop offset="100%" stopColor={C.chartB} stopOpacity={.5}/></linearGradient>
            <linearGradient id="cqFCF" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.chartC} stopOpacity={.9}/><stop offset="100%" stopColor={C.chartC} stopOpacity={.5}/></linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 4" stroke={C.border} />
          <XAxis dataKey="year" tick={{ fontSize: 11, fill: C.textMuted }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: C.textMuted }} axisLine={false} tickLine={false} tickFormatter={v => fmtMoney(v, "")} width={44} />
          <Tooltip content={<ChartTip sym={sym} />} />
          <Legend wrapperStyle={{ fontSize: 11.5, color: C.textSec, paddingTop: 8 }} />
          <Bar dataKey="Net Income" fill="url(#cqNI)" radius={[6, 6, 0, 0]} barSize={dataLen <= 2 ? 55 : 35} />
          <Bar dataKey="Free Cash Flow" fill="url(#cqFCF)" radius={[6, 6, 0, 0]} barSize={dataLen <= 2 ? 55 : 35} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function ProfitStructureChart({ data, sym }) {
  const cs = data.costStructure;
  if (!cs || !cs.length || !cs.some(c => c && c.cogsPct != null)) return null;
  const dataLen = data.years.length;
  const COLORS = { cogs: C.chartF, opex: C.chartD, tax: C.chartE, netProfit: C.chartB, other: C.textMuted };
  if (dataLen === 1) {
    const c = cs[0];
    const pieData = [
      { name: "Cost of Goods", value: c.cogsPct || 0, fill: COLORS.cogs },
      { name: "Operating Exp", value: c.opexPct || 0, fill: COLORS.opex },
      { name: "Taxes", value: c.taxPct || 0, fill: COLORS.tax },
      { name: "Net Profit", value: c.netProfitPct || 0, fill: COLORS.netProfit },
    ].filter(d => d.value > 0);
    return (
      <ChartFrame icon="🥧" title="Profit Structure" subtitle={`Where every ${sym}100 of revenue goes.`}>
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} label={({ value }) => `${value.toFixed(1)}%`} labelLine={false}>
              {pieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
            </Pie>
            <Tooltip content={<ChartTip isPct />} />
            <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: 11.5 }} />
          </PieChart>
        </ResponsiveContainer>
      </ChartFrame>
    );
  }
  const chartData = data.years.map((y, i) => {
    const c = cs[i] || {};
    return { year: String(y), "Cost of Goods": c.cogsPct || 0, "Operating Exp": c.opexPct || 0, "Taxes": c.taxPct || 0, "Net Profit": c.netProfitPct || 0, "Other": c.otherPct || 0 };
  });
  return (
    <ChartFrame icon="📊" title="Profit Structure Trend" subtitle="How 100% of revenue splits over time.">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="4 4" stroke={C.border} />
          <XAxis dataKey="year" tick={{ fontSize: 11, fill: C.textMuted }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: C.textMuted }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} width={40} domain={[0, 100]} />
          <Tooltip content={<ChartTip isPct />} />
          <Legend wrapperStyle={{ fontSize: 11.5 }} iconType="circle" />
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

function EPSChart({ data, sym }) {
  const hasData = data.eps?.some(v => v != null);
  if (!hasData) return null;
  const chartData = data.years.map((y, i) => ({ year: String(y), EPS: data.eps?.[i] }));
  const dataLen = chartData.length;
  return (
    <ChartFrame icon="📈" title="Earnings Per Share (EPS)" subtitle="What each share earned in profits.">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 30, right: 10, left: 0, bottom: 5 }}>
          <defs><linearGradient id="epsGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.chartD} stopOpacity={.9}/><stop offset="100%" stopColor={C.chartD} stopOpacity={.55}/></linearGradient></defs>
          <CartesianGrid strokeDasharray="4 4" stroke={C.border} />
          <XAxis dataKey="year" tick={{ fontSize: 11, fill: C.textMuted }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: C.textMuted }} axisLine={false} tickLine={false} tickFormatter={v => `${sym}${v}`} width={50} />
          <Tooltip content={<ChartTip sym={sym} />} />
          <Bar dataKey="EPS" fill="url(#epsGrad)" radius={[6, 6, 0, 0]} barSize={dataLen <= 2 ? 60 : 45} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function AnalysisSection({ icon, title, accentColor, paragraphs }) {
  let parts = [];
  if (Array.isArray(paragraphs)) parts = paragraphs.filter(Boolean);
  else if (typeof paragraphs === "string") parts = paragraphs.split(/\n\n+/).filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22, boxShadow: C.shadow }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: `${accentColor}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{icon}</div>
        <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 15.5, color: C.textPrimary }}>{title}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {parts.map((para, i) => (
          <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ flexShrink: 0, width: 24, height: 24, borderRadius: "50%", background: `${accentColor}15`, color: accentColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, marginTop: 2 }}>{i + 1}</div>
            <p style={{ color: C.textSec, lineHeight: 1.75, fontSize: 13.5, flex: 1, margin: 0 }}>{para}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function InsightCard({ title, items, color, icon, badgeColor }) {
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22, boxShadow: C.shadow }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: badgeColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: color, fontWeight: 700 }}>{icon}</div>
        <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 14.5, color: color }}>{title}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{ flexShrink: 0, width: 20, height: 20, borderRadius: "50%", background: badgeColor, color: color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, marginTop: 2 }}>{i + 1}</div>
            <div style={{ color: C.textSec, fontSize: 13, lineHeight: 1.65, flex: 1 }}>{item}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: 10, background: C.bgCard, border: `1.5px solid ${open ? C.accent : C.border}`, borderRadius: 14, padding: "0 16px", height: 52, minWidth: 150, fontSize: 14, fontWeight: 600, color: C.textPrimary, fontFamily: "'Plus Jakarta Sans', sans-serif", cursor: "pointer", boxShadow: C.shadow, whiteSpace: "nowrap", justifyContent: "space-between", width: "100%" }}>
        <span>{selected.short}</span>
        <span style={{ fontSize: 10, color: C.textMuted, transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s" }}>▼</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, width: "max(100%, 220px)", background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: C.shadowMd, zIndex: 50, overflow: "hidden" }}>
          {PERIODS.map(p => {
            const isActive = p.id === value;
            return (
              <button key={p.id} type="button" onClick={() => { onChange(p.id); setOpen(false); }} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, width: "100%", background: isActive ? C.accentLight : "transparent", border: "none", padding: "10px 14px", cursor: "pointer", textAlign: "left" }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: isActive ? C.accent : C.textPrimary }}>{p.label}{isActive && <span style={{ fontSize: 11, marginLeft: 6 }}>✓</span>}</span>
                <span style={{ fontSize: 11, color: C.textMuted }}>{p.desc}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DocumentReadyScreen({ docReady, onReset }) {
  const { pdfBlob, pdfFileName, docxBlob, docxFileName, companyName, summary } = docReady;
  const btn = (primary) => ({
    width: "100%", height: 48, borderRadius: 12, border: primary ? "none" : `1.5px solid ${C.border}`,
    background: primary ? C.accent : C.bgSidebar, color: primary ? "#fff" : C.textPrimary,
    fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center",
    justifyContent: "center", gap: 10, transition: "opacity 0.15s",
  });
  return (
    <div style={{ width: "100%", maxWidth: 480, margin: "16px auto 0", background: C.bgCard, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: "28px 28px 24px", boxShadow: C.shadowMd, textAlign: "center" }}>
      <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.greenBg, border: `2px solid ${C.green}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 26 }}>✓</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary, marginBottom: 6 }}>Your document is ready!</div>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: C.brown, marginBottom: 16 }}>{companyName}</div>
      <div style={{ background: C.brownLight, borderRadius: 10, padding: "12px 16px", marginBottom: 20, textAlign: "left" }}>
        {[
          summary.sectionCount > 0 && `${summary.sectionCount} sections organised`,
          summary.ratioCount > 0 && `${summary.ratioCount} financial ratios calculated`,
          summary.hasSWOT && "SWOT analysis included",
          summary.hasCharts && "Bar charts generated",
          summary.failedChunks > 0 && `${summary.failedChunks} section(s) used fallback content`,
        ].filter(Boolean).map((line, i) => (
          <div key={i} style={{ fontSize: 12.5, color: C.textSec, lineHeight: 1.8, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: C.green, fontWeight: 700 }}>•</span> {line}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {pdfBlob && (
          <button style={btn(true)} onClick={() => triggerBlobDownload(pdfBlob, pdfFileName)}>
            <span>📄</span>
            <span>Download PDF{summary.fileSizeKB > 0 ? ` · ${summary.fileSizeKB < 1024 ? summary.fileSizeKB + ' KB' : (summary.fileSizeKB / 1024).toFixed(1) + ' MB'}` : ''}</span>
          </button>
        )}
        {docxBlob && (
          <button style={btn(false)} onClick={() => triggerBlobDownload(docxBlob, docxFileName)}>
            <span>📊</span>
            <span>Download Word</span>
          </button>
        )}
        {!pdfBlob && !docxBlob && (
          <div style={{ fontSize: 12.5, color: C.red }}>Document generation failed. Please try again.</div>
        )}
      </div>
      <button onClick={onReset} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: C.textSec, textDecoration: "underline" }}>
        ⟲ Process another document
      </button>
    </div>
  );
}

const ACTIVITY_LABELS = ["🧠 AI is reading...", "📝 Extracting data...", "🔍 Analyzing structure..."];

function PrivateDocUploadZone({ onProcess, isProcessing, progress, error }) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [activityIdx, setActivityIdx] = useState(0);
  const startTimeRef = useRef(null);

  useEffect(() => {
    if (!isProcessing) { setElapsedSecs(0); setActivityIdx(0); startTimeRef.current = null; return; }
    startTimeRef.current = Date.now();
    const elapsedTimer = setInterval(() => {
      setElapsedSecs(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    const activityTimer = setInterval(() => {
      setActivityIdx(idx => (idx + 1) % ACTIVITY_LABELS.length);
    }, 2000);
    return () => { clearInterval(elapsedTimer); clearInterval(activityTimer); };
  }, [isProcessing]);

  const chunkMatch = progress?.match(/section (\d+) of (\d+)/i);
  const chunksComplete = chunkMatch ? parseInt(chunkMatch[1], 10) : 0;
  const chunksTotal = chunkMatch ? parseInt(chunkMatch[2], 10) : 0;
  const showBar = chunksTotal > 0;
  const barPct = showBar ? Math.round((chunksComplete / chunksTotal) * 100) : 0;
  const slowChunk = elapsedSecs > 0 && showBar && chunksComplete < chunksTotal &&
    (elapsedSecs - chunksComplete * 3) > 60;

  const elapsedMins = Math.floor(elapsedSecs / 60);
  const elapsedRemSecs = elapsedSecs % 60;
  const elapsedStr = elapsedMins > 0
    ? `${elapsedMins}m ${String(elapsedRemSecs).padStart(2, "0")}s`
    : `${elapsedSecs}s`;

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e) => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0]); };
  const handleFile = (file) => {
    if (!file) return;
    if (!file.name.match(/\.(pdf|docx?|doc)$/i)) { alert("Please upload a PDF or Word document (.pdf, .docx, or .doc)"); return; }
    onProcess(file);
  };

  return (
    <div style={{ width: "100%", maxWidth: 720, margin: "16px auto 0" }}>
      <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} onClick={!isProcessing ? () => fileInputRef.current?.click() : undefined}
        style={{ padding: "28px 24px", background: isDragging ? C.brownLight : (isProcessing ? "#F5F5F5" : C.bgCard), border: `2px dashed ${isDragging ? C.brown : C.border}`, borderRadius: 14, cursor: isProcessing ? "wait" : "pointer", transition: "all 0.2s", textAlign: "center", opacity: isProcessing ? 0.85 : 1, boxShadow: C.shadow }}>
        <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" onChange={(e) => handleFile(e.target.files[0])} style={{ display: "none" }} disabled={isProcessing} />
        {!isProcessing ? (
          <>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📄</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, marginBottom: 6 }}>Upload Private Company Financials</div>
            <div style={{ fontSize: 12.5, color: C.textSec, marginBottom: 8 }}>Upload PDF or Word document — drag & drop here, or click to browse</div>
            <div style={{ fontSize: 11, color: C.textMuted, fontStyle: "italic" }}>Clean XBRL output · Times New Roman · Page borders · Bar charts · SWOT · Ratio interpretations</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 24, marginBottom: 10, animation: "fs-spin 2s linear infinite", display: "inline-block" }}>⚙️</div>

            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.brown }}>{progress || "Processing..."}</div>
              <div style={{ fontSize: 12, color: C.textMuted, background: C.brownLight, borderRadius: 6, padding: "2px 8px", fontVariantNumeric: "tabular-nums" }}>Elapsed: {elapsedStr}</div>
            </div>

            {showBar && (
              <div style={{ margin: "8px auto 4px", maxWidth: 400 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.textMuted, marginBottom: 4 }}>
                  <span>Sections processed</span>
                  <span>{chunksComplete} / {chunksTotal}</span>
                </div>
                <div style={{ height: 8, background: C.border, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${barPct}%`, background: C.brown, borderRadius: 4, transition: "width 0.5s ease" }} />
                </div>
              </div>
            )}

            {slowChunk && (
              <div style={{ marginTop: 10, padding: "6px 12px", background: C.amberBg, border: `1px solid ${C.amber}`, borderRadius: 6, fontSize: 11.5, color: C.amber, display: "inline-block" }}>
                ⚠ Large section detected — taking longer than usual, please wait...
              </div>
            )}

            <div style={{ marginTop: 10, fontSize: 12, color: C.textSec, fontStyle: "italic" }}>{ACTIVITY_LABELS[activityIdx]}</div>
            <div style={{ marginTop: 4, fontSize: 11, color: C.textMuted }}>Multi-pass processing — typically 3-5 minutes for large documents</div>
          </>
        )}
      </div>
      {error && (
        <div style={{ marginTop: 12, padding: "10px 14px", background: C.redBg, border: `1px solid ${C.red}`, borderRadius: 8, fontSize: 12.5, color: C.red }}>⚠ {error}</div>
      )}
    </div>
  );
}

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');`;

const GLOBAL_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${C.bgPage}; overflow-x: hidden; }
  ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: ${C.bgPage}; }
  ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
  .fs-input:focus { outline: none; border-color: ${C.accent} !important; box-shadow: 0 0 0 3px rgba(207,107,78,.15) !important; }
  .fs-chip:hover { background: ${C.accentLight} !important; border-color: ${C.accent} !important; color: ${C.accent} !important; }
  .fs-btn-primary:hover { background: ${C.accentDark} !important; }
  .fs-card:hover { box-shadow: ${C.shadowMd} !important; border-color: ${C.borderHover} !important; }
  .fs-chart-card:hover { box-shadow: ${C.shadowMd} !important; border-color: ${C.borderHover} !important; }
  @keyframes fs-fade { from{opacity:0;transform:translateY(12px);} to{opacity:1;transform:none;} }
  @keyframes fs-spin { to { transform: rotate(360deg); } }
  .fs-search-row { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 580px; }
  @media (min-width: 640px) { .fs-search-row { flex-direction: row; max-width: 740px; } }
  .fs-search-bar { flex: 1; display: flex; gap: 8px; background: ${C.bgCard}; border: 1.5px solid ${C.border}; border-radius: 14px; padding: 6px 6px 6px 14px; box-shadow: ${C.shadow}; min-height: 52px; align-items: center; }
  .fs-metrics-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  @media (min-width: 640px) { .fs-metrics-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  @media (min-width: 1024px) { .fs-metrics-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
  .fs-charts-grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
  @media (min-width: 1024px) { .fs-charts-grid { grid-template-columns: 1fr 1fr; gap: 18px; } }
  .fs-analysis-sections { display: grid; grid-template-columns: 1fr; gap: 14px; margin-bottom: 20px; }
  @media (min-width: 1024px) { .fs-analysis-sections { grid-template-columns: 1fr 1fr; gap: 16px; } }
  .fs-insights-grid { display: grid; grid-template-columns: 1fr; gap: 14px; margin-bottom: 24px; }
  @media (min-width: 1024px) { .fs-insights-grid { grid-template-columns: 1fr 1fr 1fr; gap: 16px; } }
  .fs-section-heading { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 17px; color: ${C.textPrimary}; margin-bottom: 14px; display: flex; align-items: center; gap: 10px; margin-top: 8px; }
  .fs-section-heading::before { content: ''; width: 4px; height: 20px; background: ${C.accent}; border-radius: 2px; }
  .cl-formButtonPrimary { background-color: ${C.accent} !important; }
  .cl-formButtonPrimary:hover { background-color: ${C.accentDark} !important; }
`;

function LoginScreen() {
  return (
    <div style={{ minHeight: "100vh", background: C.bgPage, fontFamily: "'DM Sans', system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{FONTS + GLOBAL_CSS}</style>
      <div style={{ marginBottom: 24, textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 16 }}>
          <FinSightLogo size={56} />
          <div style={{ textAlign: "left" }}>
            <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 28, color: C.textPrimary, lineHeight: 1 }}>FinSight AI</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>by <span style={{ color: C.accent, fontWeight: 600 }}>{AUTHOR_NAME}</span></div>
          </div>
        </div>
        <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 20, color: C.textPrimary, marginBottom: 6 }}>Welcome to financial intelligence</h2>
        <p style={{ color: C.textSec, fontSize: 14 }}>Sign in to analyze any company's financials</p>
      </div>
      <SignIn appearance={{ elements: { card: { background: C.bgCard, border: `1px solid ${C.border}`, boxShadow: C.shadow }, formButtonPrimary: { background: C.accent } } }} />
      <div style={{ marginTop: 24, color: C.textMuted, fontSize: 12, textAlign: "center" }}>By continuing, you agree to our Terms & Privacy Policy</div>
    </div>
  );
}

function FinSightApp() {
  const { user } = useUser();
  const [screen, setScreen] = useState("landing");
  const [q, setQ] = useState("");
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [stepIdx, setStepIdx] = useState(0);
  const [excelLoading, setExcelLoading] = useState(false);
  const [pptLoading, setPptLoading] = useState(false);
  const [privateDocLoading, setPrivateDocLoading] = useState(false);
  const [privateDocProgress, setPrivateDocProgress] = useState("");
  const [privateDocError, setPrivateDocError] = useState("");
  const [docReady, setDocReady] = useState(null);

  useEffect(() => {
    if (screen !== "loading") return;
    setStepIdx(0);
    const t = setInterval(() => setStepIdx(i => Math.min(i + 1, STEPS.length - 1)), 2800);
    return () => clearInterval(t);
  }, [screen]);

  const analyze = async (company) => {
    setScreen("loading"); setErr("");
    const periodLabel = PERIODS.find(p => p.id === period)?.label || "1 Year";
    try {
      const raw = await callClaude({
        system: buildSystemPrompt(period),
        userMsg: `Analyze LATEST financial data for: ${company}. Period: ${periodLabel} (${period}). Use web search. Provide 4 segmented analysis sections, each 3 paragraphs. Return ONLY clean JSON.`,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        maxTokens: 6000,
      });
      let json = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      const s = json.indexOf("{"), e = json.lastIndexOf("}");
      if (s >= 0 && e >= 0) json = json.slice(s, e + 1);
      const parsed = JSON.parse(json);
      ['analysisRevenue', 'analysisProfitability', 'analysisCashFlow', 'analysisOutlook', 'keyStrengths', 'keyRisks', 'outlookReason', 'description'].forEach(k => {
        if (parsed[k]) parsed[k] = cleanText(parsed[k]);
      });
      setData(parsed);
      setScreen("dashboard");
    } catch (ex) { setErr(ex.message || "Analysis failed."); setScreen("error"); }
  };

  const handlePrivateDocProcess = async (file) => {
    setPrivateDocLoading(true); setPrivateDocError(""); setPrivateDocProgress(""); setDocReady(null);
    try {
      const result = await processPrivateCompanyDoc(file, (msg) => setPrivateDocProgress(msg));
      setDocReady({
        pdfBlob: result.pdfBlob,
        pdfFileName: result.pdfFileName,
        docxBlob: result.docxBlob,
        docxFileName: result.docxFileName,
        companyName: result.companyInfo?.name || 'Private Company',
        summary: {
          sectionCount: result.sectionCount,
          ratioCount: result.ratioCount,
          hasSWOT: result.hasSWOT,
          hasCharts: result.hasCharts,
          fileSizeKB: result.pdfFileSizeKB,
          failedChunks: result.failedChunks,
        }
      });
      setPrivateDocLoading(false);
      setPrivateDocProgress("");
    } catch (e) {
      setPrivateDocError(e.message || "Failed to process document.");
      setPrivateDocLoading(false); setPrivateDocProgress("");
    }
  };

  const downloadExcel = async () => {
    if (!data) return;
    setExcelLoading(true);
    try {
      const periodLabel = PERIODS.find(p => p.id === (data.periodType || period))?.label || "1 Year";
      await generateExcel(data, periodLabel);
    } catch (ex) { alert("Excel failed: " + (ex.message || "Unknown")); }
    setExcelLoading(false);
  };

  const downloadPPT = async () => {
    if (!data) return;
    setPptLoading(true);
    try {
      const periodLabel = PERIODS.find(p => p.id === (data.periodType || period))?.label || "1 Year";
      await generatePPTFull(data, periodLabel);
    } catch (ex) { alert("PPT failed: " + (ex.message || "Unknown")); }
    setPptLoading(false);
  };

  if (screen === "landing") return (
    <div style={{ minHeight: "100vh", background: C.bgPage, fontFamily: "'DM Sans', system-ui, sans-serif", display: "flex", flexDirection: "column" }}>
      <style>{FONTS + GLOBAL_CSS}</style>
      <header style={{ padding: "10px 28px", display: "flex", alignItems: "center", borderBottom: `1px solid ${C.border}`, background: C.bgCard, minHeight: 56 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <FinSightLogo size={28} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 15, color: C.textPrimary, lineHeight: 1 }}>FinSight AI</span>
            <span style={{ fontSize: 9.5, color: C.textMuted, marginTop: 2 }}>by <span style={{ color: C.accent, fontWeight: 600 }}>{AUTHOR_NAME}</span></span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <UserButton afterSignOutUrl="/" />
      </header>

      <main style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 24px 32px", animation: "fs-fade .6s ease both" }}>
        <div style={{ marginBottom: 24 }}><FinSightLogo size={64} /></div>
        <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: "clamp(28px, 7.5vw, 52px)", fontWeight: 800, color: C.textPrimary, letterSpacing: "-1.2px", textAlign: "center", lineHeight: 1.15, marginBottom: 14 }}>
          Where finance meets <span style={{ color: C.accent }}>intelligence.</span>
        </h1>
        <p style={{ color: C.textSec, fontSize: 15, lineHeight: 1.7, textAlign: "center", maxWidth: 540, marginBottom: 32 }}>
          Type any company name. Get AI-powered financial analysis with interactive charts, Excel reports, and professional PPT decks.
        </p>

        <div className="fs-search-row" style={{ marginBottom: 32 }}>
          <PeriodDropdown value={period} onChange={setPeriod} />
          <div className="fs-search-bar">
            <input className="fs-input" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && q.trim() && analyze(q.trim())}
              placeholder="e.g. Apple, Reliance, Tesla..." style={{ flex: 1, background: "none", border: "none", outline: "none", color: C.textPrimary, fontSize: 15, fontFamily: "inherit" }} />
            <button className="fs-btn-primary" onClick={() => q.trim() && analyze(q.trim())} disabled={!q.trim()}
              style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: q.trim() ? 1 : .55 }}>
              Analyze →
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", marginBottom: 32 }}>
          {[{ flag: "🇺🇸", label: "US", items: US_EX }, { flag: "🇮🇳", label: "India", items: IN_EX }].map(row => (
            <div key={row.flag} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
              <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 500, minWidth: 70, textAlign: "right" }}>{row.flag} {row.label}</span>
              {row.items.map(c => <button key={c} className="fs-chip" onClick={() => analyze(c)}
                style={{ background: C.bgCard, border: `1px solid ${C.border}`, color: C.textSec, borderRadius: 20, padding: "5px 12px", fontSize: 12.5, cursor: "pointer" }}>{c}</button>)}
            </div>
          ))}
        </div>

        <div style={{ width: "100%", maxWidth: 720, margin: "8px auto", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ flex: 1, height: 1, background: C.border }}></div>
          <div style={{ fontSize: 11, color: C.brown, fontWeight: 700, letterSpacing: "0.08em", padding: "4px 12px", background: C.brownLight, border: `1px solid ${C.border}`, borderRadius: 20 }}>
            OR ORGANIZE PRIVATE COMPANY DOCS
          </div>
          <div style={{ flex: 1, height: 1, background: C.border }}></div>
        </div>

        {docReady
          ? <DocumentReadyScreen docReady={docReady} onReset={() => setDocReady(null)} />
          : <PrivateDocUploadZone onProcess={handlePrivateDocProcess} isProcessing={privateDocLoading} progress={privateDocProgress} error={privateDocError} />
        }

        <div style={{ marginTop: 16, fontSize: 11.5, color: C.textMuted, textAlign: "center", maxWidth: 640, lineHeight: 1.6 }}>
          <strong style={{ color: C.textSec }}>What you get:</strong> Full preservation · No XBRL tags · Times New Roman · Page borders · Bar charts · SWOT · Company-specific ratio interpretations · Corporate-ready output.
        </div>
      </main>

      <footer style={{ padding: "18px 20px", textAlign: "center", borderTop: `1px solid ${C.border}`, background: C.bgCard }}>
        <span style={{ color: C.textMuted, fontSize: 11.5 }}>FinSight AI · Research & education only · Not investment advice  ·  </span><Byline />
      </footer>
    </div>
  );

  if (screen === "loading") return (
    <div style={{ minHeight: "100vh", background: C.bgPage, fontFamily: "'DM Sans', system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{FONTS + GLOBAL_CSS}</style>
      <div style={{ marginBottom: 24 }}><FinSightLogo size={52} /></div>
      <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 20, fontWeight: 700, color: C.textPrimary, marginBottom: 6 }}>Analyzing financials…</h2>
      <p style={{ color: C.textSec, fontSize: 13.5, marginBottom: 36 }}>Period: {PERIODS.find(p => p.id === period)?.label} · Takes about 20–30 seconds</p>
      <div style={{ width: "100%", maxWidth: 320 }}>
        {STEPS.map((s, i) => {
          const done = i < stepIdx, active = i === stepIdx, pending = i > stepIdx;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, opacity: pending ? .32 : 1 }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: done ? C.green : active ? C.accent : C.border }}>
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
      <div style={{ width: 56, height: 56, borderRadius: 16, background: C.redBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, marginBottom: 18 }}>⚠️</div>
      <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 19, fontWeight: 700, color: C.red, marginBottom: 10 }}>Analysis failed</h2>
      <p style={{ color: C.textSec, maxWidth: 440, lineHeight: 1.7, marginBottom: 24, fontSize: 14 }}>{err}</p>
      <button onClick={() => setScreen("landing")} style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 10, padding: "11px 26px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>← Try again</button>
    </div>
  );

  if (screen === "dashboard" && data) {
    const sym = data.currencySymbol || "$";
    const OUTLOOK = { Positive: { color: C.green, bg: C.greenBg }, Mixed: { color: C.amber, bg: C.amberBg }, Caution: { color: C.red, bg: C.redBg }, Bullish: { color: C.green, bg: C.greenBg }, Bearish: { color: C.red, bg: C.redBg } };
    const oc = OUTLOOK[data.outlook] || OUTLOOK.Mixed;
    const lastIdx = (data.years?.length || 1) - 1;
    const periodLabel = PERIODS.find(p => p.id === data.periodType)?.label || "Analysis";
    return (
      <div style={{ minHeight: "100vh", background: C.bgPage, color: C.textPrimary, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
        <style>{FONTS + GLOBAL_CSS}</style>
        <header style={{ position: "sticky", top: 0, zIndex: 100, minHeight: 60, background: C.bgCard, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "10px 28px", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FinSightLogo size={24} />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 13, color: C.textPrimary, lineHeight: 1 }}>FinSight AI</span>
              <span style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>by <span style={{ color: C.accent, fontWeight: 600 }}>{AUTHOR_NAME}</span></span>
            </div>
          </div>
          <div style={{ width: 1, height: 24, background: C.border }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flex: 1 }}>
            <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 15, fontWeight: 700 }}>{data.company}</span>
            <span style={{ background: C.bgSidebar, color: C.textSec, fontSize: 10.5, padding: "2px 7px", borderRadius: 5 }}>{data.ticker}</span>
            <span style={{ background: C.accentLight, color: C.accent, fontSize: 10.5, fontWeight: 600, padding: "2px 9px", borderRadius: 5 }}>{periodLabel}</span>
            <span style={{ background: oc.bg, color: oc.color, fontSize: 10.5, fontWeight: 600, padding: "2px 9px", borderRadius: 5 }}>{data.outlook}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
            <button onClick={() => setScreen("landing")} style={{ background: "none", border: `1px solid ${C.border}`, color: C.textSec, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12 }}>← New</button>
            <UserButton afterSignOutUrl="/" />
          </div>
        </header>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 24px 22px" }}>
          <p style={{ color: C.textSec, fontSize: 14, lineHeight: 1.75, maxWidth: 680, marginBottom: 28 }}>{data.description}</p>
          <div className="fs-metrics-grid" style={{ marginBottom: 24 }}>
            {[
              { label: `Revenue`, value: fmtMoney(data.revenue?.[lastIdx], sym), sub: data.revenueCAGR ? `CAGR ${Number(data.revenueCAGR).toFixed(1)}%` : "Latest" },
              { label: `Net Income`, value: fmtMoney(data.netIncome?.[lastIdx], sym), sub: data.netMargin?.[lastIdx] ? `Margin ${Number(data.netMargin[lastIdx]).toFixed(1)}%` : "" },
              { label: "Market Cap", value: fmtMoney(data.marketCap, sym), sub: data.exchange },
              { label: "P/E Ratio", value: data.peRatio ? `${Number(data.peRatio).toFixed(1)}×` : "N/A", sub: "Current" },
              { label: "Free Cash Flow", value: fmtMoney(data.freeCashFlow?.[lastIdx], sym), sub: "Latest" },
              { label: "Revenue Growth", value: data.revenueCAGR ? `${Number(data.revenueCAGR).toFixed(1)}%` : "N/A", sub: periodLabel, accent: C.accent },
            ].map(m => <MetricCard key={m.label} {...m} />)}
          </div>
          <div className="fs-section-heading">Financial Analysis</div>
          <div className="fs-charts-grid" style={{ marginBottom: 24 }}>
            <GrowthQualityChart data={data} sym={sym} />
            <CashQualityChart data={data} sym={sym} />
            <ProfitStructureChart data={data} sym={sym} />
            <EPSChart data={data} sym={sym} />
          </div>
          <div className="fs-section-heading">AI Financial Analysis</div>
          <div className="fs-analysis-sections">
            {data.analysisRevenue && <AnalysisSection icon="📈" title="Revenue & Growth Story" accentColor={C.chartA} paragraphs={data.analysisRevenue} />}
            {data.analysisProfitability && <AnalysisSection icon="💰" title="Profitability Performance" accentColor={C.chartB} paragraphs={data.analysisProfitability} />}
            {data.analysisCashFlow && <AnalysisSection icon="💵" title="Cash Flow Analysis" accentColor={C.chartC} paragraphs={data.analysisCashFlow} />}
            {data.analysisOutlook && <AnalysisSection icon="🎯" title="Competitive & Strategic Outlook" accentColor={C.chartD} paragraphs={data.analysisOutlook} />}
          </div>
          <div className="fs-section-heading">Key Insights</div>
          <div className="fs-insights-grid">
            <InsightCard title="Key Strengths" icon="✓" color={C.green} badgeColor={C.greenBg} items={data.keyStrengths || []} />
            <InsightCard title="Key Risks" icon="⚠" color={C.red} badgeColor={C.redBg} items={data.keyRisks || []} />
            <div style={{ background: oc.bg, border: `1px solid ${oc.color}33`, borderRadius: 14, padding: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${oc.color}22` }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: oc.color + "20", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: oc.color, fontWeight: 700 }}>◎</div>
                <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 14.5, color: oc.color }}>{data.outlook} Outlook</div>
              </div>
              <div style={{ color: C.textSec, fontSize: 13, lineHeight: 1.7 }}>{data.outlookReason}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginBottom: 24 }}>
            <button onClick={downloadPPT} disabled={pptLoading} style={{ background: C.accent, color: "#fff", border: "none", padding: "12px 24px", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
              {pptLoading ? <><Spinner /> Creating PPT…</> : <>📊 Download PPT</>}
            </button>
            <button onClick={downloadExcel} disabled={excelLoading} style={{ background: C.chartB, color: "#fff", border: "none", padding: "12px 24px", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
              {excelLoading ? <><Spinner /> Generating…</> : <>📗 Download Excel</>}
            </button>
            <button onClick={() => setScreen("landing")} style={{ background: "transparent", color: C.textSec, border: `1px solid ${C.border}`, padding: "12px 24px", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>← New search</button>
          </div>
          <div style={{ background: C.bgSidebar, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 11.5, color: C.textMuted, lineHeight: 1.6 }}>
            <strong style={{ color: C.textSec }}>Disclaimer:</strong> Research and education only. Not investment advice. Not SEBI-registered.
          </div>
          <div style={{ textAlign: "center", paddingTop: 20, borderTop: `1px solid ${C.border}` }}><Byline /></div>
        </div>
      </div>
    );
  }
  return null;
}

export default function App() {
  if (!CLERK_PUB_KEY) return (
    <div style={{ padding: 40, textAlign: "center", fontFamily: "sans-serif" }}>
      <h2 style={{ color: "#C04040" }}>⚠️ Clerk Key Missing</h2>
      <p>Please add VITE_CLERK_PUBLISHABLE_KEY to your Vercel environment variables.</p>
    </div>
  );
  return (
    <ClerkProvider publishableKey={CLERK_PUB_KEY}>
      <SignedOut><LoginScreen /></SignedOut>
      <SignedIn><FinSightApp /></SignedIn>
    </ClerkProvider>
  );
}
