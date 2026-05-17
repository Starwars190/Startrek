import { useState, useEffect, useRef } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, ComposedChart, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList
} from "recharts";
import { ClerkProvider, SignedIn, SignedOut, SignIn, UserButton, useUser } from "@clerk/clerk-react";
import * as docxLib from "docx";

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
const MODEL = "claude-sonnet-4-6";
const VISION_MODEL = "claude-sonnet-4-6";
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
    if (json.error) {
      if (json.error_type) {
        // Structured error from proxy (400/402/403): API is unavailable, not a transient failure
        const err = new Error(json.message || "API unavailable");
        err.apiUnavailable = true;
        err.errorType = json.error_type;
        throw err;
      }
      throw new Error(json.error.message || "API call failed");
    }
    return json.content.filter(b => b.type === "text").map(b => b.text).join("");
  }
}

async function callClaudeVision({ pageImages, extractionPrompt, maxTokens = 4000 }) {
  const content = [
    ...pageImages.map(img => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: img.base64 }
    })),
    { type: 'text', text: extractionPrompt }
  ];
  const body = { model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content }] };
  const RETRYABLE = new Set([429, 503, 529]);
  for (let attempt = 1; attempt <= 4; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000);
    let res;
    try {
      res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') { if (attempt > 3) throw new Error('Vision extraction timed out'); continue; }
      throw err;
    }
    clearTimeout(timeoutId);
    if (RETRYABLE.has(res.status)) {
      if (attempt > 3) throw new Error('Rate limit on vision extraction');
      await new Promise(r => setTimeout(r, 60000 * attempt));
      continue;
    }
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'Vision API failed');
    return json.content.filter(b => b.type === 'text').map(b => b.text).join('');
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
    // Split only at sentence-final punctuation + whitespace + capital letter.
    // This avoids false splits on decimal numbers like (1.003x) or abbreviations.
    const sentences = para.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
    let current = "";
    for (const s of sentences) {
      const joined = current ? current + ' ' + s : s;
      if (joined.length > 600 && current.length > 100) {
        result.push(current.trim());
        current = s;
      } else current = joined;
    }
    if (current.trim()) result.push(current.trim());
  }
  return result.filter(Boolean);
}

async function loadSheetJS() {
  if (window.XLSX) return window.XLSX;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error('Failed to load Excel library'));
    document.head.appendChild(script);
  });
}

async function loadExcelJS() {
  if (window.ExcelJS) return window.ExcelJS;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    script.onload = () => resolve(window.ExcelJS);
    script.onerror = () => reject(new Error('Failed to load ExcelJS library'));
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
  // Use the npm-installed docx package (Vite bundles the browser-compatible ESM build).
  // The old CDN UMD path caused "nodebuffer is not supported by this platform" because
  // JSZip inside the UMD bundle could pick the wrong output type in certain environments.
  return docxLib;
}

async function loadTesseract() {
  if (window.Tesseract) return window.Tesseract;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => reject(new Error('Failed to load Tesseract OCR'));
    document.head.appendChild(script);
  });
}

async function extractWordContent(file) {
  const mammoth = await loadMammoth();
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

async function extractXmlContent(file) {
  const text = await file.text();
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(text, 'application/xml');
  if (xmlDoc.querySelector('parsererror')) {
    throw new Error('XML file is invalid or cannot be parsed.');
  }
  const lines = [];
  const walk = (node) => {
    const tag = node.nodeName.replace(/^[a-zA-Z]+:/, '');
    if (tag.startsWith('#')) { for (const c of node.childNodes) walk(c); return; }
    const hasChildElements = Array.from(node.childNodes).some(c => c.nodeType === 1);
    if (!hasChildElements) {
      const val = (node.textContent || '').trim();
      if (val && val.length < 500) {
        const ctx = node.getAttribute?.('contextRef') || '';
        const period = /[Pp]rior|[Pp]rev|[Pp]Y/.test(ctx) ? ' (Prior)' : '';
        lines.push(`${tag}${period}: ${val}`);
      }
    } else {
      if (tag && tag !== 'xbrl') lines.push(`\n--- ${tag} ---`);
      for (const c of node.childNodes) walk(c);
    }
  };
  walk(xmlDoc.documentElement);
  const extracted = lines.join('\n');
  if (extracted.trim().length < 50) throw new Error('No readable data found in XML file.');
  return { text: extracted, method: 'xml', warnings: [] };
}

async function extractExcelInputContent(file) {
  const XLSX = await loadSheetJS();
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const lines = [];
  for (const sheetName of workbook.SheetNames) {
    lines.push(`\n=== Sheet: ${sheetName} ===`);
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { skipHidden: true });
    if (csv.trim()) lines.push(csv);
  }
  const extracted = lines.join('\n');
  if (extracted.trim().length < 50) throw new Error('No readable data found in Excel file.');
  return { text: extracted, method: 'excel-input', warnings: [] };
}

async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  const mod = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs');
  const lib = mod.default ?? mod;
  lib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';
  window.pdfjsLib = lib;
  return lib;
}

async function checkPdfHasText(file) {
  try {
    const pdfjsLib = await loadPdfJs();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let totalText = '';
    const pagesToSample = Math.min(3, pdf.numPages);
    for (let i = 1; i <= pagesToSample; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      totalText += content.items.map(item => item.str).join(' ');
    }
    const charsPerPage = Math.round(totalText.length / pagesToSample);
    return { hasText: charsPerPage > 200, charsPerPage, totalPages: pdf.numPages };
  } catch (e) {
    console.error('[checkPdfHasText] Check failed:', e);
    return { hasText: true, charsPerPage: 0, totalPages: 0 };
  }
}

async function renderPdfPageToCanvas(pdfPage, scale = 2.0) {
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

async function ocrPageWithTesseract(canvas) {
  const Tesseract = await loadTesseract();
  const worker = await Tesseract.createWorker('eng', 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js',
  });
  const { data } = await worker.recognize(canvas);
  await worker.terminate();
  return { text: data.text || '', confidence: data.confidence || 0 };
}

// ── STAGE 1-3: New PDF Extraction Pipeline ────────────────────────────────────

const FINANCIAL_PAGE_KEYWORDS = /revenue|turnover|profit.*loss|balance\s*sheet|cash\s*flow|assets|liabilities|equity|depreciation|particulars|lakhs|crores|₹|rs\.\s*\d|statement\s+of|schedule/i;

async function detectMcaAndMetadata(sampleText) {
  const isMCA = /\bCIN\b|\bCompanies Act,?\s*2013\b|\bMinistry of Corporate Affairs\b|\bRegistrar of Companies\b|\bMCA\b|\bForm\s+AOC/i.test(sampleText);
  // For Indian MCA filings ALWAYS force INR — never auto-detect
  const currency = isMCA ? 'INR' : (/\bUSD\b|\$/.test(sampleText) ? 'USD' : (/\bGBP\b|£/.test(sampleText) ? 'GBP' : 'INR'));
  const unit = /(?:amount|value|figure)s?\s+(?:in|are)\s+(?:indian\s+rupees?\s+in\s+)?crore|₹\s*(?:in\s+)?crore|\bCr\.\b/i.test(sampleText) ? 'Crores' : 'Lakhs';
  const cinMatch = sampleText.match(/\b([UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\b/);
  const cin = cinMatch ? cinMatch[1] : null;
  const periodMatch = sampleText.match(/(?:31st?\s+March|March\s+31),?\s+(20\d{2})/i) || sampleText.match(/\b(20\d{2})-(\d{2})\b/);
  let period = null;
  if (periodMatch) {
    period = periodMatch[1] ? `FY${periodMatch[1]}` : null;
  }
  return { isMCA, currency, unit, cin, period };
}

async function callClaudeVisionForPage(base64, pageNum, totalPages, unit) {
  const prompt = `You are a senior financial analyst extracting data from an Indian company annual report. This is page ${pageNum} of ${totalPages}.

Extract ALL financial figures with surgical precision.
Return ONLY this JSON structure, nothing else:

{
  "page_type": "profit_loss",
  "financial_year_current": "FY20XX",
  "financial_year_prior": "FY20XX",
  "currency": "INR",
  "unit": "${unit || 'Lakhs'}",
  "line_items": [
    {
      "label": "exact label as written in document",
      "category": "revenue",
      "current_year_value": null,
      "prior_year_value": null,
      "is_subtotal": false,
      "is_total": false
    }
  ],
  "extraction_confidence": "high",
  "notes": ""
}

page_type must be one of: profit_loss | balance_sheet | cash_flow | notes | schedules | other
category must be one of: revenue | expense | asset | liability | equity | cash_flow | ratio | other

ABSOLUTE RULES — violating these means wrong output:
1. NEVER confuse page numbers with financial figures. Page numbers are 1-500 appearing alone at top or bottom margin.
2. NEVER confuse footnote reference numbers (1, 2, 3 in superscript or at end of row) with financial values.
3. NEVER confuse row sequence numbers with financial values.
4. Numbers in brackets () mean NEGATIVE values — represent as negative numbers.
5. If a figure is unclear or ambiguous, return null — NEVER guess.
6. A single narrow column of small integers on the far right is note references — SKIP ENTIRELY.
7. Financial figures appear in wide columns aligned with row labels in the centre/left.
8. Do not convert units — return exactly as stated in the document.
9. If page is a cover, TOC, or director's report with no financial tables, return page_type: "other" and empty line_items array.`;

  const content = [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
    { type: 'text', text: prompt }
  ];
  const body = { model: VISION_MODEL, max_tokens: 4000, messages: [{ role: 'user', content }] };
  const RETRYABLE = new Set([429, 503, 529]);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000);
    let res;
    try {
      res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') { if (attempt >= 3) return null; continue; }
      return null;
    }
    clearTimeout(timeoutId);
    if (res.status === 401 || res.status === 403) return null; // API key issue
    if (RETRYABLE.has(res.status)) {
      if (attempt >= 3) return null;
      await new Promise(r => setTimeout(r, 30000 * attempt));
      continue;
    }
    const json = await res.json();
    if (json.error) return null;
    const text = json.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
    let clean = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(clean); } catch { return null; }
  }
  return null;
}

function mergeVisionPageIntoYears(visionYears, pageResult) {
  if (!pageResult || !pageResult.line_items || pageResult.line_items.length === 0) return;
  if (pageResult.page_type === 'other') return;

  const curYr = pageResult.financial_year_current;
  const priYr = pageResult.financial_year_prior;
  if (!curYr) return;

  if (!visionYears[curYr]) visionYears[curYr] = { profit_loss: {}, balance_sheet: {}, cash_flow: {} };
  if (priYr && !visionYears[priYr]) visionYears[priYr] = { profit_loss: {}, balance_sheet: {}, cash_flow: {} };

  const sectionMap = { profit_loss: 'profit_loss', balance_sheet: 'balance_sheet', cash_flow: 'cash_flow' };
  const pt = pageResult.page_type;
  const section = sectionMap[pt] || null;
  if (!section) return;

  for (const item of pageResult.line_items) {
    if (!item.label) continue;
    const lbl = item.label.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const field = mapVisionLabelToField(lbl, section);
    if (!field) continue;

    if (item.current_year_value != null && !isNaN(item.current_year_value)) {
      if (visionYears[curYr][section][field] == null) {
        visionYears[curYr][section][field] = item.current_year_value;
      }
    }
    if (priYr && item.prior_year_value != null && !isNaN(item.prior_year_value)) {
      if (visionYears[priYr][section][field] == null) {
        visionYears[priYr][section][field] = item.prior_year_value;
      }
    }
  }
}

function mapVisionLabelToField(lbl, section) {
  if (section === 'profit_loss') {
    if (/revenue from oper|net sales|net revenue|turnover/.test(lbl)) return 'revenue';
    if (/other income/.test(lbl)) return 'other_income';
    if (/total income|total revenue/.test(lbl)) return 'total_income';
    if (/cost of material|cost of goods|purchases of stock|raw material/.test(lbl)) return 'cost_of_goods';
    if (/employee benefit|staff cost|personnel|salaries/.test(lbl)) return 'employee_costs';
    if (/finance cost|interest expense|borrowing cost/.test(lbl)) return 'finance_costs';
    if (/depreciation|amortis/.test(lbl)) return 'depreciation';
    if (/other expense/.test(lbl)) return 'other_expenses';
    if (/total expense/.test(lbl)) return 'total_expenses';
    if (/ebitda/.test(lbl)) return 'ebitda';
    if (/profit before tax|pbt/.test(lbl)) return 'pbt';
    if (/tax expense|provision for tax|income tax/.test(lbl) && !/deferred tax asset/.test(lbl)) return 'tax_expense';
    if (/profit for the year|profit for the period|net profit|pat\b|profit after tax/.test(lbl) && !/before tax/.test(lbl)) return 'net_income';
  }
  if (section === 'balance_sheet') {
    if (/total assets/.test(lbl)) return 'total_assets';
    if (/total current assets/.test(lbl)) return 'current_assets';
    if (/total non.?current assets/.test(lbl)) return 'non_current_assets';
    if (/property plant|net block|tangible asset|ppe/.test(lbl)) return 'fixed_assets';
    if (/cash and cash equiv|cash and bank/.test(lbl)) return 'cash_and_equivalents';
    if (/trade receivabl/.test(lbl)) return 'trade_receivables';
    if (/inventor/.test(lbl) && !/change in/.test(lbl)) return 'inventory';
    if (/total equity|shareholders funds|net worth/.test(lbl)) return 'total_equity';
    if (/share capital/.test(lbl)) return 'share_capital';
    if (/reserves and surplus|other equity/.test(lbl)) return 'reserves';
    if (/total liabilit/.test(lbl) && !/current/.test(lbl)) return 'total_liabilities';
    if (/total current liabilit/.test(lbl)) return 'current_liabilities';
    if (/long.?term borrowing|non.?current borrowing/.test(lbl)) return 'long_term_debt';
    if (/short.?term borrowing|current borrowing/.test(lbl) && !/non.?current/.test(lbl)) return 'short_term_debt';
    if (/trade payabl/.test(lbl)) return 'trade_payables';
  }
  if (section === 'cash_flow') {
    if (/operating activit|from operations/.test(lbl)) return 'cfo';
    if (/investing activit/.test(lbl)) return 'cfi';
    if (/financing activit/.test(lbl)) return 'cff';
    if (/net change in cash|net increase|net decrease/.test(lbl)) return 'net_change_in_cash';
    if (/closing cash|cash at end/.test(lbl)) return 'closing_cash';
  }
  return null;
}

function applySanityBlocking(years, sortedYears, unitHint) {
  const errorLog = [];
  const isLakhs = (unitHint || '').toLowerCase() === 'lakhs';
  // Threshold for "private company revenue too large": 200,000 Crores
  // In Lakhs: 200000 * 100 = 20,000,000 Lakhs; In Crores: 200000
  const maxRevenue = isLakhs ? 20_000_000 : 200_000;

  for (const yr of sortedYears) {
    const data = years[yr];
    if (!data) continue;
    const pl = data.profit_loss || {};
    const bs = data.balance_sheet || {};
    const cf = data.cash_flow || {};

    const block = (obj, field, value, reason) => {
      errorLog.push({ yr, field, blocked_value: value, reason });
      obj[field] = null;
    };

    // Revenue > 200,000 Crores for a private company
    if (pl.revenue != null && pl.revenue > maxRevenue) {
      block(pl, 'revenue', pl.revenue, `Revenue exceeds 200,000 Crores — impossible for private company (unit: ${unitHint})`);
    }
    // Total Assets < Total Equity (impossible)
    if (bs.total_assets != null && bs.total_equity != null && bs.total_assets < bs.total_equity) {
      block(bs, 'total_assets', bs.total_assets, 'Total Assets < Total Equity — impossible');
    }
    // Cash > Total Assets (impossible)
    if (bs.cash_and_equivalents != null && bs.total_assets != null && bs.cash_and_equivalents > bs.total_assets) {
      block(bs, 'cash_and_equivalents', bs.cash_and_equivalents, 'Cash > Total Assets — impossible');
    }
    // Finance costs > Revenue (impossible)
    if (pl.finance_costs != null && pl.revenue != null && pl.finance_costs > pl.revenue && pl.revenue > 0) {
      block(pl, 'finance_costs', pl.finance_costs, 'Finance Costs > Revenue — impossible');
    }
    // Tax > PBT when PBT is positive (impossible, unless deferred tax creates temporary inversion)
    if (pl.tax_expense != null && pl.pbt != null && pl.pbt > 0 && pl.tax_expense > pl.pbt * 1.5) {
      block(pl, 'tax_expense', pl.tax_expense, 'Tax > 150% of PBT — likely extraction error');
    }
    // Single/double digit revenue when other figures are large (page number confusion)
    if (pl.revenue != null && Math.abs(pl.revenue) < 1000) {
      const otherLarge = [bs.total_assets, bs.total_equity, pl.pbt, pl.net_income]
        .some(v => v != null && Math.abs(v) > 10000);
      if (otherLarge) {
        block(pl, 'revenue', pl.revenue, `Revenue ${pl.revenue} appears to be a page number or footnote — blocked`);
      }
    }
  }

  // YoY change checks
  for (let i = 1; i < sortedYears.length; i++) {
    const prevPl = (years[sortedYears[i-1]]?.profit_loss) || {};
    const currPl = (years[sortedYears[i]]?.profit_loss) || {};
    if (prevPl.revenue && currPl.revenue && prevPl.revenue !== 0) {
      const change = (currPl.revenue - prevPl.revenue) / Math.abs(prevPl.revenue);
      if (change > 5) {
        errorLog.push({ yr: sortedYears[i], field: 'revenue', blocked_value: currPl.revenue, reason: `Revenue change +${(change*100).toFixed(0)}% YoY > 500% — blocked as likely error` });
        currPl.revenue = null;
      } else if (change < -0.9) {
        errorLog.push({ yr: sortedYears[i], field: 'revenue', blocked_value: currPl.revenue, reason: `Revenue change ${(change*100).toFixed(0)}% YoY < -90% — flagged for review` });
        // FLAG only, don't block
      }
    }
  }

  // Check all years identical (copy error)
  if (sortedYears.length >= 2) {
    const revs = sortedYears.map(yr => years[yr]?.profit_loss?.revenue);
    if (revs.every(v => v != null) && revs.every(v => v === revs[0])) {
      errorLog.push({ yr: 'all', field: 'revenue', blocked_value: revs[0], reason: 'All years identical — likely copy/extraction error' });
    }
  }

  return errorLog;
}

function countValidFigures(years) {
  let count = 0;
  for (const yr of Object.values(years || {})) {
    for (const section of Object.values(yr || {})) {
      if (typeof section === 'object' && section !== null) {
        for (const val of Object.values(section)) {
          if (val != null && !isNaN(val) && isFinite(val)) count++;
        }
      }
    }
  }
  return count;
}

async function extractPdfContent(file, onProgress) {
  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();

  // ── Open PDF ────────────────────────────────────────────────────────────────
  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (err.name === 'PasswordException' || msg.includes('password') || msg.includes('encrypt')) {
      throw new Error('PASSWORD_PROTECTED');
    }
    throw new Error('CORRUPT_PDF');
  }

  const totalPages = pdf.numPages;
  onProgress?.(`🔍 Analysing document structure... (${totalPages} pages detected)`);

  // ── STAGE 1: Document Intelligence ──────────────────────────────────────────
  // Sample first 5 pages for metadata detection
  let sampleText = '';
  const sampleCount = Math.min(5, totalPages);
  for (let i = 1; i <= sampleCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    sampleText += ' ' + content.items.map(item => item.str).join(' ');
  }
  const docMeta = await detectMcaAndMetadata(sampleText);
  const { isMCA, currency, unit, cin } = docMeta;

  onProgress?.(`💱 ${isMCA ? 'Indian MCA filing detected' : 'Document classified'} — Currency: ${currency}, Unit: ${unit}`);

  // ── STAGE 2: Page Classification ─────────────────────────────────────────────
  onProgress?.('📋 Classifying pages...');
  const pageTexts = [];
  const financialPageNums = [];

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join(' ');
    pageTexts.push(text);
    if (FINANCIAL_PAGE_KEYWORDS.test(text) && text.length > 50) {
      financialPageNums.push(i);
    }
  }

  const totalChars = pageTexts.reduce((s, t) => s + t.length, 0);
  const charsPerPage = totalPages > 0 ? totalChars / totalPages : 0;
  const isScanned = charsPerPage < 200;
  const isHybrid = !isScanned && financialPageNums.some(pn => (pageTexts[pn - 1] || '').length < 200);
  const docType = isScanned ? 'scanned' : (isHybrid ? 'hybrid' : 'text-based');

  onProgress?.(`📋 Page classification complete — ${financialPageNums.length} financial pages found (document type: ${docType})`);

  // ── STAGE 3: Claude Vision for ALL financial pages ───────────────────────────
  const visionYears = {};
  const visionPageLog = [];

  if (financialPageNums.length > 0) {
    onProgress?.(`🤖 Claude Vision processing financial pages... (0/${financialPageNums.length} pages)`);
    let visionSuccess = 0;

    for (let vi = 0; vi < financialPageNums.length; vi++) {
      const pageNum = financialPageNums[vi];
      onProgress?.(`🤖 Claude Vision processing financial pages... (${vi + 1}/${financialPageNums.length} pages)`);
      try {
        const page = await pdf.getPage(pageNum);
        const canvas = await renderPdfPageToCanvas(page, 2.0);
        const base64 = canvas.toDataURL('image/png').split(',')[1];
        const result = await callClaudeVisionForPage(base64, pageNum, totalPages, unit);
        if (result && result.line_items) {
          mergeVisionPageIntoYears(visionYears, result);
          visionPageLog.push({ page: pageNum, method: 'Claude Vision', confidence: result.extraction_confidence, pageType: result.page_type, itemCount: result.line_items.length });
          visionSuccess++;
        } else {
          visionPageLog.push({ page: pageNum, method: 'Claude Vision', confidence: 'failed', pageType: 'unknown', itemCount: 0 });
        }
      } catch (vErr) {
        console.warn(`[Vision] Page ${pageNum} failed:`, vErr.message);
        visionPageLog.push({ page: pageNum, method: 'Claude Vision', confidence: 'error', pageType: 'unknown', itemCount: 0, error: vErr.message });
      }
    }

    if (visionSuccess > 0) {
      onProgress?.(`✅ Claude Vision extracted data from ${visionSuccess}/${financialPageNums.length} pages`);
    } else {
      onProgress?.('⚠️ Claude Vision unavailable — relying on text extraction only');
    }
  }

  // Apply sanity blocking on vision-extracted data
  const visionSortedYears = Object.keys(visionYears).sort();
  const visionErrorLog = applySanityBlocking(visionYears, visionSortedYears, unit);
  if (visionErrorLog.length > 0) {
    onProgress?.(`🔢 Sanity checks blocked ${visionErrorLog.length} suspicious figure(s)`);
    console.warn('[SanityBlocking]', visionErrorLog);
  }

  // ── STAGE 3B: Tesseract OCR for scanned/hybrid pages ───────────────────────
  const ocrTexts = [...pageTexts];
  if (isScanned || isHybrid) {
    onProgress?.('📄 Extracting text from scanned pages via OCR...');
    let tessOk = true;
    for (let i = 1; i <= totalPages; i++) {
      if ((pageTexts[i - 1] || '').length > 200) continue;
      if (!tessOk) break;
      try {
        const page = await pdf.getPage(i);
        const canvas = await renderPdfPageToCanvas(page, 2.0);
        const { text } = await ocrPageWithTesseract(canvas);
        if (text.trim().length > 20) ocrTexts[i - 1] = text;
      } catch (tessErr) {
        console.warn('[OCR] Tesseract failed:', tessErr.message);
        tessOk = false;
      }
    }
  }

  const finalText = ocrTexts.join('\n\n');
  const method = isScanned ? 'ocr' : (isHybrid ? 'hybrid' : 'text');
  const warnings = finalText.trim().length < 500
    ? ['Very limited text was extracted. Financial data may be incomplete.']
    : [];

  return {
    text: finalText,
    method,
    warnings,
    documentMetadata: { isMCA, currency, unit, cin, financialPageNums, totalPages, docType, visionPageLog },
    visionStructuredData: { years: visionYears, currency, unit, isMCA, errorLog: visionErrorLog },
  };
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
    "tradePayables": null or number,
    "revenue": null or number, "grossProfit": null or number,
    "operatingProfit": null or number, "ebitda": null or number,
    "pbt": null or number,
    "netIncome": null or number, "interestExpense": null or number,
    "tax": null or number, "totalTax": null or number,
    "cogs": null or number,
    "depreciation": null or number, "operatingCashFlow": null or number,
    "investingCashFlow": null or number, "financingCashFlow": null or number
  },
  "financialDataExtractedPrior": {
    "totalAssets": null or number, "currentAssets": null or number,
    "nonCurrentAssets": null or number, "totalLiabilities": null or number,
    "currentLiabilities": null or number, "nonCurrentLiabilities": null or number,
    "totalEquity": null or number, "longTermDebt": null or number,
    "shortTermDebt": null or number, "inventory": null or number,
    "receivables": null or number, "cash": null or number, "fixedAssets": null or number,
    "tradePayables": null or number,
    "revenue": null or number, "grossProfit": null or number,
    "operatingProfit": null or number, "ebitda": null or number,
    "pbt": null or number,
    "netIncome": null or number, "interestExpense": null or number,
    "tax": null or number, "totalTax": null or number,
    "cogs": null or number,
    "depreciation": null or number, "operatingCashFlow": null or number,
    "investingCashFlow": null or number, "financingCashFlow": null or number
  }
}

REMEMBER:
- Apply XBRL CLEANING to every header, title, cell value before outputting.
- PRESERVE every preamble narrative section (Financial Highlights, POSH, Secretarial Standards, etc.)
- financialDataExtracted = CURRENT YEAR values (numbers only). Convert "34,149.08" to 34149.08.
- financialDataExtractedPrior = PRIOR YEAR values (the comparative column, typically labeled "Previous Year" or the earlier date range).

P&L EXTRACTION — CRITICAL (read carefully):
From the Statement of Profit and Loss, map these EXACT lines:
  "Revenue from Operations" / "Total Revenue" / "Total Income" → revenue
  "Cost of Materials Consumed" + "Purchases of Stock-in-Trade" + "Changes in Inventory of FG/WIP" → cogs
    (cogs = sum of those three items ONLY. Do NOT include Employee Benefits, Finance Costs, Depreciation, Other Expenses, or Tax)
  "Finance Costs" / "Interest Expense" → interestExpense
  "Depreciation and Amortization" → depreciation
  "Profit/(Loss) before tax" (the line AFTER exceptional items, BEFORE tax) → pbt
  "Total Tax Expense" (sum of Current Tax + Deferred Tax) → totalTax
    Also store totalTax in the "tax" field.
  "Profit/(Loss) for the period" / "Profit/(Loss) for the year" (the FINAL line after tax) → netIncome

CRITICAL VALIDATION — before you return the JSON, verify:
  netIncome MUST NOT equal totalTax exactly. If they match exactly, you mis-identified a line — re-read and fix.
  pbt should approximately equal netIncome + totalTax. If not, flag with a note but still return your best values.
  Do NOT return null for netIncome or pbt if a line with that label appears in the chunk — even if it's negative.

BALANCE SHEET EXTRACTION — CRITICAL:
  "Long-term Borrowings" (Non-current Liabilities section) → longTermDebt
    If this line exists with value 0, return 0 (not null). Return null ONLY if the line is absent from the filing.
    Do NOT confuse "Deferred Tax Liabilities" with longTermDebt — they are different items.
  "Short-term Borrowings" (Current Liabilities section) → shortTermDebt
  "Trade Payables" / "Creditors for goods/services" → tradePayables

- tradePayables = Trade Payables / Creditors for goods/services (from Balance Sheet Notes or current liabilities breakdown).`;
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

const FINANCIAL_KEYS = [
  "totalAssets","currentAssets","nonCurrentAssets","totalLiabilities","currentLiabilities",
  "nonCurrentLiabilities","totalEquity","longTermDebt","shortTermDebt","inventory",
  "receivables","cash","fixedAssets","tradePayables","revenue","grossProfit","operatingProfit",
  "ebitda","pbt","netIncome","interestExpense","tax","totalTax","cogs","depreciation",
  "operatingCashFlow","investingCashFlow","financingCashFlow"
];

function aggregateFinancialData(chunkResults) {
  const aggregated = Object.fromEntries(FINANCIAL_KEYS.map(k => [k, null]));
  for (const chunk of chunkResults) {
    const data = chunk.financialDataExtracted || {};
    for (const key of FINANCIAL_KEYS) {
      if (aggregated[key] == null && data[key] != null && !isNaN(parseFloat(data[key]))) {
        aggregated[key] = parseFloat(data[key]);
      }
    }
  }
  // If short-term borrowings were found but long-term was never extracted, the LT
  // line almost certainly exists in the filing at zero — treat null as 0 in that case.
  if (aggregated.longTermDebt == null && aggregated.shortTermDebt != null)
    aggregated.longTermDebt = 0;
  return aggregated;
}

function aggregatePriorFinancialData(chunkResults) {
  const aggregated = Object.fromEntries(FINANCIAL_KEYS.map(k => [k, null]));
  for (const chunk of chunkResults) {
    const data = chunk.financialDataExtractedPrior || {};
    for (const key of FINANCIAL_KEYS) {
      if (aggregated[key] == null && data[key] != null && !isNaN(parseFloat(data[key]))) {
        aggregated[key] = parseFloat(data[key]);
      }
    }
  }
  if (aggregated.longTermDebt == null && aggregated.shortTermDebt != null)
    aggregated.longTermDebt = 0;
  return aggregated;
}

function computeDerivedFinancials(agg) {
  // Prefer totalTax over the ambiguous "tax" field (AI sometimes mis-maps)
  if (agg.totalTax != null && agg.tax == null) agg.tax = agg.totalTax;

  // Detect tax === netIncome extraction bug and clear the bad field
  if (agg.tax != null && agg.netIncome != null && agg.tax === agg.netIncome) {
    console.warn('[computeDerivedFinancials] tax === netIncome — extraction error detected; clearing tax');
    agg.tax = null;
    // If we have pbt and netIncome we can back-calculate tax
    if (agg.pbt != null) agg.tax = agg.pbt - agg.netIncome;
  }

  if (agg.grossProfit == null && agg.revenue != null && agg.cogs != null)
    agg.grossProfit = agg.revenue - agg.cogs;

  // Prefer pbt-based operatingProfit (pbt + interestExpense = EBIT ≈ operatingProfit)
  if (agg.operatingProfit == null && agg.pbt != null && agg.interestExpense != null)
    agg.operatingProfit = agg.pbt + agg.interestExpense;
  // Fallback: back-calculate from netIncome
  if (agg.operatingProfit == null && agg.netIncome != null && agg.interestExpense != null && agg.tax != null)
    agg.operatingProfit = agg.netIncome + agg.interestExpense + agg.tax;

  if (agg.ebitda == null && agg.operatingProfit != null && agg.depreciation != null)
    agg.ebitda = agg.operatingProfit + agg.depreciation;
  if (agg.currentAssets != null && agg.currentLiabilities != null)
    agg.workingCapital = agg.currentAssets - agg.currentLiabilities;
  if (agg.longTermDebt != null || agg.shortTermDebt != null)
    agg.totalDebt = (agg.longTermDebt ?? 0) + (agg.shortTermDebt ?? 0);
  return agg;
}

function calculateRatios(fd, sectorHint = "general", fdPrior = null) {
  const fmt = (val, decimals = 2, suffix = "") => {
    if (val == null || isNaN(val) || !isFinite(val)) return "—";
    const sign = val < 0 ? "(" : "";
    const closing = val < 0 ? ")" : "";
    return sign + Math.abs(val).toFixed(decimals) + suffix + closing;
  };
  const safe = (n, d) => (n != null && d != null && d !== 0 && !isNaN(n) && !isNaN(d)) ? (n / d) : null;
  const safeMul = (n, m) => (n != null && m != null && !isNaN(n) && !isNaN(m)) ? (n * m) : null;
  const safeAdd = (...vals) => vals.every(v => v != null && !isNaN(v)) ? vals.reduce((a, b) => a + b, 0) : null;

  // Capital employed: requires equity; debt components default to 0 if absent
  const capitalEmployed = fd.totalEquity != null
    ? (fd.totalEquity ?? 0) + (fd.longTermDebt ?? 0) + (fd.shortTermDebt ?? 0)
    : null;
  const totalDebt = (fd.longTermDebt != null || fd.shortTermDebt != null)
    ? (fd.longTermDebt ?? 0) + (fd.shortTermDebt ?? 0) : null;
  const workingCapital = (fd.currentAssets != null && fd.currentLiabilities != null)
    ? fd.currentAssets - fd.currentLiabilities : null;
  const avgInventory = (fdPrior?.inventory != null && fd.inventory != null)
    ? (fd.inventory + fdPrior.inventory) / 2 : fd.inventory;
  const dso = safeMul(safe(fd.receivables, fd.revenue), 365);
  const dio = safeMul(safe(avgInventory, fd.cogs), 365);
  const dpo = fd.tradePayables != null ? safeMul(safe(fd.tradePayables, fd.cogs), 365) : null;
  const ccc = (dso != null && dio != null && dpo != null) ? dso + dio - dpo : null;

  const r = (name, rawValue, type, formula, interpretation) => ({
    name, formula, interpretation, type,
    rawValue,
    value: rawValue == null || isNaN(rawValue) || !isFinite(rawValue) ? "—"
      : type === "percent" ? fmt(rawValue, 2, "%")
      : type === "multiple" ? fmt(rawValue, 2, "x")
      : type === "days" ? fmt(rawValue, 0, " days")
      : fmt(rawValue, 2),
  });

  const ratios = [];

  ratios.push({ category: "Profitability Ratios", items: [
    r("Gross Margin",          safeMul(safe(fd.grossProfit, fd.revenue), 100),     "percent",   "Gross Profit / Revenue × 100",               "Pricing power and cost efficiency."),
    r("EBITDA Margin",         safeMul(safe(fd.ebitda, fd.revenue), 100),          "percent",   "EBITDA / Revenue × 100",                     "Operating cash generation as % of revenue."),
    r("Operating Margin",      safeMul(safe(fd.operatingProfit, fd.revenue), 100), "percent",   "Operating Profit / Revenue × 100",           "Operating efficiency before interest and tax."),
    r("Net Margin",            safeMul(safe(fd.netIncome, fd.revenue), 100),       "percent",   "Net Income / Revenue × 100",                 "Bottom-line profitability after all costs."),
    r("Return on Equity (ROE)",safeMul(safe(fd.netIncome, fd.totalEquity), 100),   "percent",   "Net Income / Total Equity × 100",            "Returns generated for shareholders."),
    r("Return on Assets (ROA)",safeMul(safe(fd.netIncome, fd.totalAssets), 100),   "percent",   "Net Income / Total Assets × 100",            "Asset utilization efficiency."),
    r("ROCE", (fd.operatingProfit != null && capitalEmployed != null && capitalEmployed > 0) ? (fd.operatingProfit / capitalEmployed) * 100 : null, "percent", "Operating Profit / (Equity + Total Debt) × 100", "Return on all capital deployed (equity + debt). India's preferred return metric. Above 15% is strong."),
  ]});

  ratios.push({ category: "Liquidity Ratios", items: [
    r("Current Ratio", safe(fd.currentAssets, fd.currentLiabilities),                              "multiple", "Current Assets / Current Liabilities",              "Above 1.5 is healthy. Short-term solvency."),
    r("Quick Ratio",   safe((fd.currentAssets ?? 0) - (fd.inventory ?? 0), fd.currentLiabilities), "multiple", "(Current Assets − Inventory) / Current Liabilities", "Above 1.0 is healthy. Excludes inventory."),
  ]});

  ratios.push({ category: "Leverage Ratios", items: [
    r("Debt-to-Equity (LT)",   safe(fd.longTermDebt, fd.totalEquity),  "multiple", "Long-term Debt / Total Equity",              "Long-term leverage. Below 1.0 is healthy."),
    r("Total Debt / Equity",   safe(totalDebt, fd.totalEquity),        "multiple", "(LT Debt + ST Debt) / Total Equity",         "Total leverage including short-term debt."),
    r("Total Debt / Assets",   safe(totalDebt, fd.totalAssets),        "multiple", "(LT Debt + ST Debt) / Total Assets",         "Portion of all assets financed by debt."),
    r("Interest Coverage",     safe(fd.operatingProfit, fd.interestExpense), "multiple", "Operating Profit / Interest Expense",   "Above 3x is healthy. Debt-service capacity."),
    r("DSCR (Approx)",         safe(fd.operatingProfit, fd.interestExpense), "multiple", "Operating Profit / Interest Expense (proxy)", "Approximation using interest only. Above 1.25x is healthy."),
  ]});

  const effItems = [
    r("Asset Turnover",          safe(fd.revenue, fd.totalAssets),    "multiple", "Revenue / Total Assets",                          "Efficiency of total asset base."),
    r("Inventory Turnover",      safe(fd.cogs, avgInventory),         "multiple", `COGS / ${fdPrior?.inventory != null ? "Avg " : ""}Inventory`, "Higher = faster stock movement."),
    r("Inventory Days (DIO)",    dio,                                  "days",     `(${fdPrior?.inventory != null ? "Avg " : ""}Inventory / COGS) × 365`, "Days stock is held before sale."),
    r("Receivables Days (DSO)",  dso,                                  "days",     "(Receivables / Revenue) × 365",                   "Lower is better. Collection efficiency."),
    r("Working Capital",         workingCapital,                       "number",   "Current Assets − Current Liabilities",            "Absolute working capital in reporting units."),
    r("Working Capital Days",    safeMul(safe(workingCapital, fd.revenue), 365), "days", "(Working Capital / Revenue) × 365",         "Days of revenue tied up in working capital."),
  ];
  if (dpo != null) {
    effItems.push(r("Payable Days (DPO)", dpo, "days", "(Trade Payables / COGS) × 365", "Days to pay suppliers. Higher can improve cash flow."));
  }
  if (ccc != null) {
    effItems.push(r("Cash Conversion Cycle", ccc, "days", "DSO + DIO − DPO", "Days to convert investments into cash. Lower is better."));
  }
  ratios.push({ category: "Efficiency Ratios", items: effItems });

  const sector = (sectorHint || "").toLowerCase();
  const sectorItems = [];
  if (sector.includes("medical") || sector.includes("pharma") || sector.includes("health")) {
    sectorItems.push(r("Working Capital Intensity", safeMul(safe(workingCapital, fd.revenue), 100), "percent", "Working Capital / Revenue × 100", "Capital intensity of operations."));
  }
  if (sector.includes("manufactur") || sector.includes("medical") || sector.includes("pharma")) {
    sectorItems.push(r("Fixed Asset Turnover", safe(fd.revenue, fd.fixedAssets), "multiple", "Revenue / Fixed Assets", "Fixed asset utilization efficiency."));
  }
  if (sectorItems.length > 0) ratios.push({ category: "Sector-Specific Ratios", items: sectorItems });
  return ratios;
}

async function generateSWOTAndInterpretation(companyInfo, aggregated, ratios, onProgress, aggregatedPrior = null) {
  onProgress?.("Generating SWOT analysis and ratio interpretations...");
  const ratiosFlat = (ratios || []).flatMap(r => r.items.map(i => `${i.name}: ${i.value} (${r.category})`)).join('\n');
  const systemPrompt = `You are a senior financial analyst for an Indian private company. Generate SPECIFIC SWOT and ratio interpretations - no generic advice.

Output ONLY JSON:
{
  "strengths": ["4-5 specific strengths"],
  "weaknesses": ["4-5 specific weaknesses"],
  "opportunities": ["4-5 specific opportunities"],
  "threats": ["4-5 specific threats"],
  "executiveOutlook": "2-3 sentences covering: overall financial health, primary concern or strength, and a forward-looking observation. Reference actual numbers and sector. Must be company-specific.",
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
    if (e.apiUnavailable) {
      console.warn('[SWOT] API unavailable — using rule-based fallback');
      return generateRuleBasedSWOT(companyInfo, aggregated, aggregatedPrior, ratios);
    }
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
  const isPercentage = (data.unit || '').includes('Percentage') || (data.unit || '').includes('%');
  const formatBarLabel = (v) => {
    if (isPercentage) return v.toFixed(2) + '%';
    if (Math.abs(v) >= 100000) return (v / 100000).toFixed(1) + 'L';
    if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'K';
    return v.toFixed(0);
  };
  const hasNegative = validValues.some(v => v < 0);
  const dataMin = Math.min(0, ...validValues);
  const dataMax = Math.max(0, ...validValues);
  const axisPad = (dataMax - dataMin) * 0.2 || 1;
  const yMin = dataMin - axisPad;
  const yMax = dataMax + axisPad;
  const range = yMax - yMin;
  const zeroY = padding.top + ((yMax) / range) * chartH;
  ctx.strokeStyle = '#E5E5E5'; ctx.lineWidth = 1;
  ctx.fillStyle = '#666666';
  ctx.font = '16px "Times New Roman"'; ctx.textAlign = 'right';
  const gridSteps = 5;
  for (let i = 0; i <= gridSteps; i++) {
    const y = padding.top + (chartH * i / gridSteps);
    const val = yMax - (range * i / gridSteps);
    ctx.beginPath(); ctx.moveTo(padding.left, y);
    ctx.lineTo(canvas.width - padding.right, y); ctx.stroke();
    const label = isPercentage ? val.toFixed(1) + '%'
      : Math.abs(val) >= 100000 ? (val / 100000).toFixed(1) + 'L'
      : Math.abs(val) >= 1000 ? (val / 1000).toFixed(1) + 'K'
      : val.toFixed(0);
    ctx.fillText(label, padding.left - 12, y + 6);
  }
  ctx.strokeStyle = '#333333'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + chartH);
  ctx.lineTo(canvas.width - padding.right, padding.top + chartH); ctx.stroke();
  const xLabelY = padding.top + chartH + (hasNegative ? 60 : 35);
  const barWidth = (chartW / data.values.length) * 0.55;
  const barSpacing = chartW / data.values.length;
  const colors = data.colors || ['#CF6B4E', '#2D7D5C', '#3B82B0', '#7C5CB8', '#D9A441', '#8B6F47'];
  data.values.forEach((val, i) => {
    if (val == null || isNaN(val)) {
      ctx.fillStyle = '#999'; ctx.font = 'italic 14px "Times New Roman"'; ctx.textAlign = 'center';
      ctx.fillText('N/A', padding.left + barSpacing * i + barSpacing / 2, zeroY);
    } else {
      const x = padding.left + (barSpacing * i) + (barSpacing - barWidth) / 2;
      const barH = Math.abs((val / range) * chartH);
      const y = val >= 0 ? zeroY - barH : zeroY;
      const grad = ctx.createLinearGradient(x, y, x, y + barH);
      grad.addColorStop(0, colors[i % colors.length]);
      grad.addColorStop(1, colors[i % colors.length] + 'AA');
      ctx.fillStyle = grad; ctx.fillRect(x, y, barWidth, barH);
      ctx.fillStyle = '#1F1B18'; ctx.font = 'bold 18px "Times New Roman"'; ctx.textAlign = 'center';
      ctx.fillText(formatBarLabel(val), x + barWidth / 2, val >= 0 ? y - 12 : y + barH + 25);
    }
    ctx.fillStyle = '#333333'; ctx.font = '16px "Times New Roman"'; ctx.textAlign = 'center';
    const labelLines = (data.labels[i] || '').split(' ');
    if (labelLines.length > 2) {
      const mid = Math.ceil(labelLines.length / 2);
      ctx.fillText(labelLines.slice(0, mid).join(' '), padding.left + barSpacing * i + barSpacing / 2, xLabelY);
      ctx.fillText(labelLines.slice(mid).join(' '), padding.left + barSpacing * i + barSpacing / 2, xLabelY + 25);
    } else {
      ctx.fillText(data.labels[i] || '', padding.left + barSpacing * i + barSpacing / 2, xLabelY);
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
  console.log('triggerBlobDownload called:', {
    blob,
    type: typeof blob,
    constructor: blob?.constructor?.name,
    size: blob?.size,
    fileName,
  });
  try {
    if (!blob) throw new Error('blob is null or undefined');
    if (!(blob instanceof Blob)) throw new Error('not a Blob: ' + typeof blob);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch(err) {
    console.error('triggerBlobDownload failed:', err);
  }
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

async function generateOrganizedWordDoc(chunkResults, companyInfo, ratios, swot, chartImages, originalFileName, extraParams = {}) {
  const { documentMetadata = {}, visionStructuredData = {}, aggregated: aggFin = {}, aggregatedPrior: aggPrior = {} } = extraParams;
  const docx = await loadDocx();
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    BorderStyle, AlignmentType, WidthType, PageNumber, Header, Footer, ShadingType, ImageRun
  } = docx;

  // Goldman Sachs / Corporate color palette
  const NAVY  = "0F2044";
  const GOLD  = "B7860F";
  const DK    = "1A202C";
  const MID   = "4A5568";
  const LIGHT = "E8EFF8";
  const WHITE = "FFFFFF";
  const BLACK = "000000";

  const noBorder = { style: BorderStyle.NONE, size: 0, color: WHITE };
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

  const navyBorder = {
    top:    { style: BorderStyle.SINGLE, size: 6, color: NAVY },
    bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY },
    left:   { style: BorderStyle.SINGLE, size: 6, color: NAVY },
    right:  { style: BorderStyle.SINGLE, size: 6, color: NAVY },
  };

  const thinBorder = {
    top:    { style: BorderStyle.SINGLE, size: 4, color: "C5D3E8" },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: "C5D3E8" },
    left:   { style: BorderStyle.SINGLE, size: 4, color: "C5D3E8" },
    right:  { style: BorderStyle.SINGLE, size: 4, color: "C5D3E8" },
  };

  const txt = (str, opts = {}) => new TextRun({
    text: String(str || ""),
    font: opts.font || "Times New Roman",
    size: opts.size || 22,
    bold: opts.bold || false,
    italics: opts.italics || false,
    color: opts.color || DK,
  });

  const para = (children, opts = {}) => new Paragraph({
    children: Array.isArray(children) ? children : [children],
    alignment: opts.align || AlignmentType.LEFT,
    spacing: opts.spacing || { before: 120, after: 120, line: 320 },
  });

  const cell = (children, opts = {}) => new TableCell({
    children: Array.isArray(children) ? children : [children],
    borders: opts.borders || thinBorder,
    width: opts.width,
    shading: opts.shading,
    verticalAlign: opts.verticalAlign || "center",
    margins: opts.margins || { top: 100, bottom: 100, left: 140, right: 140 },
  });

  // Section header: large navy heading (14pt = size 28)
  const sectionHeader = (number, title) => para(
    [txt(`${number ? number + ".  " : ""}${humanizeTitle(title)}`, {
      font: "Times New Roman", size: 28, bold: true, color: NAVY
    })],
    { align: AlignmentType.LEFT, spacing: { before: 500, after: 180, line: 340 } }
  );

  // Horizontal rule via table
  const hrule = (color = "C5D3E8", thickness = 8) => new Table({
    rows: [new TableRow({ children: [new TableCell({
      children: [new Paragraph({ children: [] })],
      borders: { top: { style: BorderStyle.SINGLE, size: thickness, color }, bottom: noBorder, left: noBorder, right: noBorder },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    })] })],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideH: noBorder, insideV: noBorder },
  });

  const subSectionHeader = (title) => para(
    [txt(humanizeTitle(title), { font: "Times New Roman", size: 26, bold: true, color: NAVY })],
    { spacing: { before: 400, after: 160, line: 340 } }
  );

  const subheading = (title) => para(
    [txt(humanizeTitle(title), { font: "Times New Roman", size: 23, bold: true, color: NAVY })],
    { spacing: { before: 260, after: 120, line: 320 } }
  );

  const disclaimer = (rounding) => para(
    [txt(`Unless otherwise specified, all monetary values are in ${rounding || "Lakhs"} of INR`, {
      font: "Times New Roman", size: 18, italics: true, color: MID
    })],
    { align: AlignmentType.RIGHT, spacing: { before: 80, after: 160 } }
  );

  const blankLine = () => para([txt("", { size: 12 })], { spacing: { before: 80, after: 80 } });
  const pageBreak = () => new Paragraph({ children: [new TextRun({ text: "" })], pageBreakBefore: true });

  // Traffic-light logic for ratios
  const RATIO_BENCHMARKS = {
    'Gross Margin (%)':         { low: 20,  high: 60  },
    'Net Margin (%)':           { low: 0,   high: 80, warnLow: 0 },
    'EBITDA Margin (%)':        { low: 8,   high: 40  },
    'Current Ratio':            { low: 1.2, high: 3.0 },
    'Quick Ratio':              { low: 0.8, high: 2.5 },
    'Debt-to-Equity':           { low: 0,   high: 1.5, invertLogic: true },
    'Return on Equity (%)':     { low: 10,  high: 30  },
    'Return on Assets (%)':     { low: 5,   high: 20  },
    'Interest Coverage':        { low: 2,   high: 10  },
    'Inventory Turnover':       { low: 3,   high: 15  },
  };
  function getRatioLight(name, rawValue) {
    if (rawValue == null || isNaN(rawValue)) return '⚪';
    const b = RATIO_BENCHMARKS[name];
    if (!b) return '⚪';
    if (b.invertLogic) return rawValue <= b.high ? '🟢' : rawValue <= b.high * 1.5 ? '🟡' : '🔴';
    if (rawValue >= b.low && rawValue <= b.high) return '🟢';
    if (rawValue >= b.low * 0.7 && rawValue <= b.high * 1.3) return '🟡';
    return '🔴';
  }

  // Key-value pair filtering: skip sensitive / identity fields
  const SENSITIVE_LABEL_RE = /pan|din|cin|gst|aadhaar|address|pin\s*code|tax.*number|registration.*number|passport/i;
  const LOOKS_LIKE_ID = /^[A-Z0-9]{10,}$/;
  function shouldSkipKVPair(label, value) {
    if (!label) return true;
    if (SENSITIVE_LABEL_RE.test(label)) return true;
    if (value == null || value === '' || value === 'null' || value === '0' || value === 'undefined') return true;
    const strVal = String(value).trim();
    if (!strVal || strVal === '—') return false; // keep em-dashes
    if (LOOKS_LIKE_ID.test(strVal)) return true;
    return false;
  }

  const allSections = [];
  const reportDate = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  // ═══════════════════════════════════════════════════════════════
  // PAGE 1 — COVER PAGE (Goldman Sachs style)
  // ═══════════════════════════════════════════════════════════════

  // Top navy banner
  allSections.push(new Table({
    rows: [new TableRow({ children: [new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text: "  ", size: 6 })] })],
      shading: { type: ShadingType.SOLID, color: NAVY },
      borders: noBorders,
      margins: { top: 200, bottom: 200, left: 100, right: 100 },
    })] })],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideH: noBorder, insideV: noBorder },
  }));

  // Logo placeholder box
  allSections.push(blankLine());
  allSections.push(new Table({
    rows: [new TableRow({ children: [
      new TableCell({ children: [new Paragraph({ children: [], spacing: { before: 200 } })], borders: noBorders, width: { size: 25, type: WidthType.PERCENTAGE }, margins: { top: 0, bottom: 0, left: 0, right: 0 } }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "[ COMPANY LOGO ]", font: "Times New Roman", size: 22, color: NAVY, bold: true })], spacing: { before: 300, after: 300 } })],
        borders: navyBorder,
        shading: { type: ShadingType.SOLID, color: "F0F5FC" },
        width: { size: 50, type: WidthType.PERCENTAGE },
        margins: { top: 200, bottom: 200, left: 200, right: 200 },
      }),
      new TableCell({ children: [new Paragraph({ children: [], spacing: { before: 200 } })], borders: noBorders, width: { size: 25, type: WidthType.PERCENTAGE }, margins: { top: 0, bottom: 0, left: 0, right: 0 } }),
    ] })],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideH: noBorder, insideV: noBorder },
  }));

  allSections.push(blankLine());

  // Company name
  allSections.push(para(
    [txt(companyInfo.name || "PRIVATE COMPANY", { font: "Times New Roman", size: 52, bold: true, color: NAVY })],
    { align: AlignmentType.CENTER, spacing: { before: 400, after: 200, line: 440 } }
  ));

  // Horizontal rule (navy)
  allSections.push(hrule(NAVY, 12));

  allSections.push(para(
    [txt("FINANCIAL ANALYSIS REPORT", { font: "Times New Roman", size: 28, bold: true, color: NAVY })],
    { align: AlignmentType.CENTER, spacing: { before: 240, after: 120 } }
  ));

  if (companyInfo.period) {
    allSections.push(para(
      [txt(`Period: ${preserveDateRanges(companyInfo.period)}`, { font: "Times New Roman", size: 20, italics: true, color: MID })],
      { align: AlignmentType.CENTER, spacing: { before: 100, after: 80 } }
    ));
  }

  allSections.push(para(
    [txt("Confidential — Prepared by FinSight AI", { font: "Times New Roman", size: 18, italics: true, color: MID })],
    { align: AlignmentType.CENTER, spacing: { before: 80, after: 40 } }
  ));
  allSections.push(para(
    [txt("finsightai.org", { font: "Times New Roman", size: 16, color: MID })],
    { align: AlignmentType.CENTER, spacing: { before: 40, after: 40 } }
  ));
  allSections.push(para(
    [txt(reportDate, { font: "Times New Roman", size: 16, color: MID })],
    { align: AlignmentType.CENTER, spacing: { before: 40, after: 240 } }
  ));

  // Dark navy bottom bar
  allSections.push(new Table({
    rows: [new TableRow({ children: [new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text: "  " })] })],
      shading: { type: ShadingType.SOLID, color: NAVY },
      borders: noBorders,
      margins: { top: 160, bottom: 160, left: 200, right: 200 },
    })] })],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideH: noBorder, insideV: noBorder },
  }));

  // ═══════════════════════════════════════════════════════════════
  // PAGE 2 — TABLE OF CONTENTS
  // ═══════════════════════════════════════════════════════════════
  allSections.push(pageBreak());
  allSections.push(para(
    [txt("TABLE OF CONTENTS", { font: "Times New Roman", size: 32, bold: true, color: NAVY })],
    { align: AlignmentType.LEFT, spacing: { before: 200, after: 200 } }
  ));
  allSections.push(hrule(NAVY, 10));
  allSections.push(blankLine());

  const tocEntries = [
    ["1", "Executive Summary",          "Key metrics, highlights and investment thesis"],
    ["2", "Company & Industry Overview","Business profile, industry context and competitive position"],
    ["3", "Financial Performance",      "Profit & Loss deep dive with YoY variance analysis"],
    ["4", "Balance Sheet Analysis",     "Asset composition, liabilities and capital structure"],
    ["5", "Cash Flow & Working Capital","Operating, investing, financing cash flows and liquidity cycle"],
    ["6", "Ratio Analysis",             "20 key ratios with sector benchmarks and traffic-light status"],
    ["7", "SWOT Analysis",              "Strengths, Weaknesses, Opportunities and Threats — data-backed"],
    ["8", "Risk Assessment & Outlook",  "Risk register, 12-month outlook, conclusion and disclaimer"],
  ];
  const tocRows = [];
  tocRows.push(new TableRow({
    tableHeader: true,
    children: [
      cell(para(txt("No.", { font: "Times New Roman", size: 20, bold: true, color: WHITE }), { spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders, width: { size: 6, type: WidthType.PERCENTAGE }, margins: { top: 100, bottom: 100, left: 120, right: 120 } }),
      cell(para(txt("Section", { font: "Times New Roman", size: 20, bold: true, color: WHITE }), { spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders, width: { size: 30, type: WidthType.PERCENTAGE }, margins: { top: 100, bottom: 100, left: 120, right: 120 } }),
      cell(para(txt("Description", { font: "Times New Roman", size: 20, bold: true, color: WHITE }), { spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders, width: { size: 64, type: WidthType.PERCENTAGE }, margins: { top: 100, bottom: 100, left: 120, right: 120 } }),
    ]
  }));
  for (let i = 0; i < tocEntries.length; i++) {
    const [num, section, desc] = tocEntries[i];
    const isAlt = i % 2 === 0;
    const bg = isAlt ? LIGHT : WHITE;
    tocRows.push(new TableRow({
      children: [
        cell(para(txt(num, { font: "Times New Roman", size: 20, bold: true, color: NAVY }), { align: AlignmentType.CENTER, spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: bg }, borders: thinBorder, width: { size: 6, type: WidthType.PERCENTAGE } }),
        cell(para(txt(section, { font: "Times New Roman", size: 20, bold: true, color: DK }), { spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: bg }, borders: thinBorder, width: { size: 30, type: WidthType.PERCENTAGE } }),
        cell(para(txt(desc, { font: "Times New Roman", size: 19, color: MID }), { spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: bg }, borders: thinBorder, width: { size: 64, type: WidthType.PERCENTAGE } }),
      ]
    }));
  }
  allSections.push(new Table({ rows: tocRows, width: { size: 100, type: WidthType.PERCENTAGE } }));

  // ═══════════════════════════════════════════════════════════════
  // PAGE 3 — EXECUTIVE SUMMARY
  // ═══════════════════════════════════════════════════════════════
  allSections.push(pageBreak());
  allSections.push(sectionHeader("1", "Executive Summary"));
  allSections.push(hrule(NAVY, 8));
  allSections.push(blankLine());

  // Executive outlook paragraphs
  const execOutlook = swot?.executiveOutlook || "";
  const outlookParas = execOutlook ? splitNarrativeIntoParagraphs(execOutlook) : [];
  const mainParas = outlookParas.slice(0, outlookParas.length > 1 ? outlookParas.length - 1 : outlookParas.length);
  const lastPara = outlookParas.length > 1 ? outlookParas[outlookParas.length - 1] : null;

  for (const p of mainParas) {
    if (!p || !p.trim()) continue;
    allSections.push(para(
      [txt(fullClean(p.trim()), { font: "Times New Roman", size: 22, color: DK })],
      { align: AlignmentType.JUSTIFIED, spacing: { before: 140, after: 160, line: 340 } }
    ));
  }

  // Key financial highlights box
  const highlightItems = [];
  if (ratios && ratios.length > 0) {
    const allItems = ratios.flatMap(cat => cat.items || []);
    const findRatio = (name) => allItems.find(it => it.name === name || (it.name || '').includes(name.split(' ')[0]));
    const gm = findRatio('Gross Margin (%)');
    const nm = findRatio('Net Margin (%)');
    const cr = findRatio('Current Ratio');
    if (gm && gm.value !== '—') highlightItems.push(`Gross Margin: ${gm.value}`);
    if (nm && nm.value !== '—') highlightItems.push(`Net Margin: ${nm.value}`);
    if (cr && cr.value !== '—') highlightItems.push(`Current Ratio: ${cr.value}`);
  }
  if (highlightItems.length > 0) {
    allSections.push(subSectionHeader("Key Financial Highlights"));
    for (const hi of highlightItems) {
      allSections.push(para(
        [txt("  ●  ", { font: "Times New Roman", size: 22, bold: true, color: NAVY }), txt(hi, { font: "Times New Roman", size: 22, color: DK })],
        { spacing: { before: 80, after: 80, line: 320 }, indent: { left: 360, hanging: 220 } }
      ));
    }
  }

  // Critical risks
  const topThreats = (swot?.threats || []).slice(0, 3);
  if (topThreats.length > 0) {
    allSections.push(subSectionHeader("Critical Risks"));
    for (const risk of topThreats) {
      if (!risk || !risk.trim()) continue;
      allSections.push(para(
        [txt("  ⚠  ", { font: "Times New Roman", size: 22, bold: true, color: "C04040" }), txt(risk.trim(), { font: "Times New Roman", size: 22, color: DK })],
        { spacing: { before: 80, after: 80, line: 320 }, indent: { left: 360, hanging: 260 } }
      ));
    }
  }

  // Investment thesis
  const thesisPara = lastPara
    ? fullClean(lastPara.trim())
    : `${companyInfo.name || "The Company"} demonstrates key financial characteristics that merit careful analysis by investors and stakeholders. The financial data extracted from official filings has been analyzed to provide an objective assessment of operational and financial performance.`;
  if (thesisPara) {
    allSections.push(subSectionHeader("Investment Thesis"));
    allSections.push(new Table({
      rows: [new TableRow({ children: [new TableCell({
        children: [para([txt(thesisPara, { font: "Times New Roman", size: 21, italics: true, color: DK })], { align: AlignmentType.JUSTIFIED, spacing: { before: 120, after: 120, line: 340 } })],
        shading: { type: ShadingType.SOLID, color: LIGHT },
        borders: { top: { style: BorderStyle.SINGLE, size: 12, color: NAVY }, bottom: noBorder, left: noBorder, right: noBorder },
        margins: { top: 200, bottom: 200, left: 240, right: 240 },
      })] })],
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideH: noBorder, insideV: noBorder },
    }));
  }
  allSections.push(disclaimer(companyInfo.rounding));

  // ─── helpers used for financial tables ───────────────────────
  const unit     = documentMetadata.unit     || companyInfo.rounding || "Lakhs";
  const currency = documentMetadata.currency || "INR";

  const fmtInr = (val) => {
    if (val == null || isNaN(val) || !isFinite(val)) return "—";
    const abs = Math.abs(val);
    const sign = val < 0 ? "(" : "";
    const closing = val < 0 ? ")" : "";
    return `${sign}₹${abs.toLocaleString('en-IN')}${closing}`;
  };
  const yoyStr = (cur, prior) => {
    if (cur == null || prior == null || prior === 0 || isNaN(cur) || isNaN(prior)) return "—";
    const pct = ((cur - prior) / Math.abs(prior)) * 100;
    return `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`;
  };

  // ═══════════════════════════════════════════════════════════════
  // PAGES 4-5 — COMPANY & INDUSTRY OVERVIEW
  // ═══════════════════════════════════════════════════════════════
  allSections.push(pageBreak());
  allSections.push(sectionHeader("2", "Company & Industry Overview"));
  allSections.push(hrule(NAVY, 8));
  allSections.push(blankLine());

  {
    let narrativeAdded = false;
    const FINANCIAL_ONLY_RE = /^(profit|income statement|balance sheet|cash flow|financial statements?|statement of)/i;
    for (const chunkResult of chunkResults) {
      if (!chunkResult.blocks || chunkResult.blocks.length === 0) continue;
      const secTitle = chunkResult.sectionTitle || "";
      if (FINANCIAL_ONLY_RE.test(secTitle)) continue;
      for (const block of chunkResult.blocks) {
        if (block.type === "paragraph_block") {
          const paragraphs = Array.isArray(block.paragraphs)
            ? block.paragraphs
            : (block.content ? splitNarrativeIntoParagraphs(block.content) : []);
          for (const p of paragraphs) {
            if (!p || p.trim().length < 40) continue;
            const cleanP = fullClean(p.trim());
            if (!cleanP) continue;
            if (block.title && !narrativeAdded) allSections.push(subSectionHeader(block.title));
            allSections.push(para(
              [txt(cleanP, { font: "Times New Roman", size: 22, color: DK })],
              { align: AlignmentType.JUSTIFIED, spacing: { before: 120, after: 160, line: 340 } }
            ));
            narrativeAdded = true;
          }
        } else if (block.type === "key_value_table" && block.pairs && block.pairs.length > 0) {
          const tableTitle = (block.title || "").toLowerCase();
          if (!/director|management|board|officer|chairman|ceo|cfo|md\b|key person/i.test(tableTitle)) continue;
          const tableRows = [];
          for (const pair of block.pairs) {
            if (!pair || !pair.label) continue;
            const labelClean = fullClean(pair.label);
            if (shouldSkipKVPair(labelClean, pair.value)) continue;
            const valueClean = pair.value == null ? "—" : fullClean(String(pair.value)) || "—";
            tableRows.push(new TableRow({ children: [
              cell(para(txt(labelClean, { font: "Times New Roman", size: 21, bold: true, color: DK }), { spacing: { before: 80, after: 80 } }), { width: { size: 42, type: WidthType.PERCENTAGE }, borders: thinBorder }),
              cell(para(txt(valueClean, { font: "Times New Roman", size: 21, color: MID }), { spacing: { before: 80, after: 80 } }), { width: { size: 58, type: WidthType.PERCENTAGE }, borders: thinBorder }),
            ]}));
          }
          if (tableRows.length > 0) {
            if (block.title) allSections.push(subSectionHeader(block.title));
            allSections.push(new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
            allSections.push(blankLine());
            narrativeAdded = true;
          }
        }
      }
    }
    if (!narrativeAdded) {
      allSections.push(para(
        [txt(`${companyInfo.name || "The Company"} operates in the ${companyInfo.sector || "corporate"} sector. For a detailed company background, please refer to the Directors' Report and Management Discussion & Analysis sections of the source filing. Financial performance analysis is presented in the subsequent sections of this report.`, { font: "Times New Roman", size: 22, color: DK })],
        { align: AlignmentType.JUSTIFIED, spacing: { before: 120, after: 160, line: 340 } }
      ));
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PAGES 6-7 — FINANCIAL PERFORMANCE (P&L)
  // ═══════════════════════════════════════════════════════════════
  allSections.push(pageBreak());
  allSections.push(sectionHeader("3", "Financial Performance"));
  allSections.push(hrule(NAVY, 8));
  allSections.push(disclaimer(unit));
  allSections.push(blankLine());

  {
    const colW = [45, 25, 18, 12];
    const mkHdr = (label, align = AlignmentType.LEFT) =>
      cell(para(txt(label, { font: "Times New Roman", size: 20, bold: true, color: WHITE }), { align, spacing: { before: 80, after: 80 } }),
        { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders });

    const plRows = [];
    plRows.push(new TableRow({ tableHeader: true, children: [
      mkHdr("Particulars"),
      mkHdr(companyInfo.period || "Current Year", AlignmentType.RIGHT),
      mkHdr("Prior Year", AlignmentType.RIGHT),
      mkHdr("YoY", AlignmentType.RIGHT),
    ]}));

    const plLine = (label, cur, prior, isTotal, isSub = false, skipIfNull = false) => {
      if (skipIfNull && cur == null && prior == null) return null;
      const yov = yoyStr(cur, prior);
      const yoyColor = yov.startsWith("▲") ? "1B6B4A" : (yov.startsWith("▼") ? "C04040" : "999999");
      const bg = isTotal ? LIGHT : WHITE;
      return new TableRow({ children: [
        cell(para(txt(label, { font: "Times New Roman", size: 20, bold: isTotal, color: isTotal ? NAVY : DK }),
          { indent: isSub ? { left: 360 } : {}, spacing: { before: 60, after: 60 } }),
          { shading: { type: ShadingType.SOLID, color: bg }, borders: thinBorder, width: { size: colW[0], type: WidthType.PERCENTAGE } }),
        cell(para(txt(fmtInr(cur), { font: "Times New Roman", size: 20, bold: isTotal, color: (cur != null && cur < 0) ? "C04040" : (isTotal ? NAVY : DK) }),
          { align: AlignmentType.RIGHT, spacing: { before: 60, after: 60 } }),
          { shading: { type: ShadingType.SOLID, color: bg }, borders: thinBorder, width: { size: colW[1], type: WidthType.PERCENTAGE } }),
        cell(para(txt(fmtInr(prior), { font: "Times New Roman", size: 20, color: MID }),
          { align: AlignmentType.RIGHT, spacing: { before: 60, after: 60 } }),
          { shading: { type: ShadingType.SOLID, color: bg }, borders: thinBorder, width: { size: colW[2], type: WidthType.PERCENTAGE } }),
        cell(para(txt(yov, { font: "Times New Roman", size: 18, bold: true, color: yoyColor }),
          { align: AlignmentType.RIGHT, spacing: { before: 60, after: 60 } }),
          { shading: { type: ShadingType.SOLID, color: bg }, borders: thinBorder, width: { size: colW[3], type: WidthType.PERCENTAGE } }),
      ]});
    };
    const marginRow = (label, pct) => pct == null ? null : new TableRow({ children: [
      cell(para(txt(label, { font: "Times New Roman", size: 18, italics: true, color: MID }), { indent: { left: 360 }, spacing: { before: 40, after: 40 } }), { shading: { type: ShadingType.SOLID, color: LIGHT }, borders: thinBorder }),
      cell(para(txt(pct, { font: "Times New Roman", size: 18, italics: true, color: NAVY }), { align: AlignmentType.RIGHT, spacing: { before: 40, after: 40 } }), { shading: { type: ShadingType.SOLID, color: LIGHT }, borders: thinBorder }),
      cell(para(txt("", { font: "Times New Roman", size: 18 }), { spacing: { before: 40, after: 40 } }), { shading: { type: ShadingType.SOLID, color: LIGHT }, borders: thinBorder }),
      cell(para(txt("", { font: "Times New Roman", size: 18 }), { spacing: { before: 40, after: 40 } }), { shading: { type: ShadingType.SOLID, color: LIGHT }, borders: thinBorder }),
    ]});

    const ebitdaMgn = (aggFin.ebitda != null && aggFin.revenue != null && aggFin.revenue !== 0)
      ? ((aggFin.ebitda / aggFin.revenue) * 100).toFixed(1) + "%" : null;
    const pbtMgn   = (aggFin.pbt != null && aggFin.revenue != null && aggFin.revenue !== 0)
      ? ((aggFin.pbt / aggFin.revenue) * 100).toFixed(1) + "%" : null;
    const patMgn   = (aggFin.netIncome != null && aggFin.revenue != null && aggFin.revenue !== 0)
      ? ((aggFin.netIncome / aggFin.revenue) * 100).toFixed(1) + "%" : null;

    const addRow = (r) => { if (r) plRows.push(r); };
    addRow(plLine("Revenue from Operations",  aggFin.revenue,         aggPrior.revenue,         false));
    addRow(plLine("Cost of Goods Sold",        aggFin.cogs,            aggPrior.cogs,            false, true, true));
    addRow(plLine("Gross Profit",              aggFin.grossProfit,     aggPrior.grossProfit,     true));
    addRow(plLine("Employee Benefit Expenses", null,                   null,                     false, true, true));
    addRow(plLine("Finance Costs",             aggFin.interestExpense, aggPrior.interestExpense, false, true, true));
    addRow(plLine("Depreciation & Amort.",     aggFin.depreciation,    aggPrior.depreciation,    false, true, true));
    addRow(plLine("EBITDA",                    aggFin.ebitda,          aggPrior.ebitda,          true));
    addRow(marginRow("  EBITDA Margin %", ebitdaMgn));
    addRow(plLine("Operating Profit (EBIT)",   aggFin.operatingProfit, aggPrior.operatingProfit, false, false, true));
    addRow(plLine("Profit Before Tax (PBT)",   aggFin.pbt,             aggPrior.pbt,             true));
    addRow(marginRow("  PBT Margin %", pbtMgn));
    addRow(plLine("Tax Expense",               aggFin.tax,             aggPrior.tax,             false, true, true));
    addRow(plLine("Profit After Tax (PAT)",    aggFin.netIncome,       aggPrior.netIncome,       true));
    addRow(marginRow("  Net Profit Margin %", patMgn));

    if (plRows.length > 1) {
      allSections.push(new Table({ rows: plRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    } else {
      allSections.push(para([txt("Financial statement data could not be extracted. Please refer to the source filing.", { font: "Times New Roman", size: 22, color: DK })], { spacing: { before: 120, after: 160 } }));
    }
    allSections.push(blankLine());

    // KPI callout boxes
    const kpis = [
      aggFin.revenue  != null ? { label: "Revenue",     value: fmtInr(aggFin.revenue),  sub: `${unit} of ${currency}` } : null,
      aggFin.ebitda   != null ? { label: "EBITDA",      value: fmtInr(aggFin.ebitda),   sub: ebitdaMgn ? `Margin: ${ebitdaMgn}` : unit } : null,
      aggFin.netIncome!= null ? { label: "Net Profit",  value: fmtInr(aggFin.netIncome),sub: patMgn ? `Margin: ${patMgn}` : unit } : null,
    ].filter(Boolean);
    if (kpis.length > 0) {
      allSections.push(subSectionHeader("Key Performance Indicators"));
      const cw = Math.floor(100 / kpis.length);
      allSections.push(new Table({
        rows: [new TableRow({ children: kpis.map(kpi => new TableCell({
          children: [
            para([txt(kpi.label, { font: "Times New Roman", size: 20, bold: true, color: WHITE })], { align: AlignmentType.CENTER, spacing: { before: 80, after: 40 } }),
            para([txt(kpi.value, { font: "Times New Roman", size: 26, bold: true, color: WHITE })], { align: AlignmentType.CENTER, spacing: { before: 40, after: 40 } }),
            para([txt(kpi.sub,   { font: "Times New Roman", size: 16, italics: true, color: "C5D3E8" })], { align: AlignmentType.CENTER, spacing: { before: 40, after: 80 } }),
          ],
          shading: { type: ShadingType.SOLID, color: NAVY },
          borders: { top: noBorder, bottom: noBorder, left: { style: BorderStyle.SINGLE, size: 4, color: "C5D3E8" }, right: { style: BorderStyle.SINGLE, size: 4, color: "C5D3E8" } },
          width: { size: cw, type: WidthType.PERCENTAGE },
          margins: { top: 200, bottom: 200, left: 200, right: 200 },
        }))})],
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideH: noBorder, insideV: noBorder },
      }));
      allSections.push(blankLine());
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PAGE 8 — BALANCE SHEET ANALYSIS
  // ═══════════════════════════════════════════════════════════════
  allSections.push(pageBreak());
  allSections.push(sectionHeader("4", "Balance Sheet Analysis"));
  allSections.push(hrule(NAVY, 8));
  allSections.push(disclaimer(unit));
  allSections.push(blankLine());

  {
    const bsRow = (label, cur, prior, isTotal = false, isSub = false, skipNull = false) => {
      if (skipNull && cur == null && prior == null) return null;
      return new TableRow({ children: [
        cell(para(txt(label, { font: "Times New Roman", size: 20, bold: isTotal, color: isTotal ? NAVY : DK }),
          { indent: isSub ? { left: 360 } : {}, spacing: { before: 60, after: 60 } }),
          { shading: { type: ShadingType.SOLID, color: isTotal ? LIGHT : WHITE }, borders: thinBorder, width: { size: 50, type: WidthType.PERCENTAGE } }),
        cell(para(txt(fmtInr(cur), { font: "Times New Roman", size: 20, bold: isTotal, color: isTotal ? NAVY : DK }),
          { align: AlignmentType.RIGHT, spacing: { before: 60, after: 60 } }),
          { shading: { type: ShadingType.SOLID, color: isTotal ? LIGHT : WHITE }, borders: thinBorder, width: { size: 28, type: WidthType.PERCENTAGE } }),
        cell(para(txt(fmtInr(prior), { font: "Times New Roman", size: 20, color: MID }),
          { align: AlignmentType.RIGHT, spacing: { before: 60, after: 60 } }),
          { shading: { type: ShadingType.SOLID, color: isTotal ? LIGHT : WHITE }, borders: thinBorder, width: { size: 22, type: WidthType.PERCENTAGE } }),
      ]});
    };
    const bsSect = (label) => new TableRow({ children: [
      cell(para(txt(label, { font: "Times New Roman", size: 19, bold: true, color: WHITE }), { spacing: { before: 60, after: 60 } }),
        { shading: { type: ShadingType.SOLID, color: "1B3A6B" }, borders: noBorders, columnSpan: 3 }),
    ]});
    const addBs = (r) => { if (r) bsRows.push(r); };

    const bsRows = [];
    bsRows.push(new TableRow({ tableHeader: true, children: [
      cell(para(txt("Particulars", { font: "Times New Roman", size: 20, bold: true, color: WHITE }), { spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders }),
      cell(para(txt(companyInfo.period || "Current Year", { font: "Times New Roman", size: 20, bold: true, color: WHITE }), { align: AlignmentType.RIGHT, spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders }),
      cell(para(txt("Prior Year", { font: "Times New Roman", size: 20, bold: true, color: WHITE }), { align: AlignmentType.RIGHT, spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders }),
    ]}));
    bsRows.push(bsSect("ASSETS"));
    addBs(bsRow("Fixed Assets (Net Block)",    aggFin.fixedAssets,       aggPrior.fixedAssets,       false, true, true));
    addBs(bsRow("Current Assets",              aggFin.currentAssets,     aggPrior.currentAssets,     false, true, true));
    addBs(bsRow("  Inventories",               aggFin.inventory,         aggPrior.inventory,         false, true, true));
    addBs(bsRow("  Trade Receivables",         aggFin.receivables,       aggPrior.receivables,       false, true, true));
    addBs(bsRow("  Cash & Equivalents",        aggFin.cash,              aggPrior.cash,              false, true, true));
    addBs(bsRow("TOTAL ASSETS",               aggFin.totalAssets,       aggPrior.totalAssets,       true));
    bsRows.push(bsSect("EQUITY & LIABILITIES"));
    addBs(bsRow("Total Shareholders' Equity",  aggFin.totalEquity,       aggPrior.totalEquity,       true,  false, true));
    addBs(bsRow("Long-term Borrowings",        aggFin.longTermDebt,      aggPrior.longTermDebt,      false, true,  true));
    addBs(bsRow("Short-term Borrowings",       aggFin.shortTermDebt,     aggPrior.shortTermDebt,     false, true,  true));
    addBs(bsRow("Current Liabilities",         aggFin.currentLiabilities,aggPrior.currentLiabilities,false, true,  true));
    addBs(bsRow("  Trade Payables",            aggFin.tradePayables,     aggPrior.tradePayables,     false, true,  true));

    if (aggFin.totalAssets != null && aggFin.totalEquity != null) {
      const totalLiabilities = aggFin.totalLiabilities != null
        ? aggFin.totalLiabilities
        : (aggFin.currentLiabilities ?? 0) + (aggFin.longTermDebt ?? 0) + (aggFin.shortTermDebt ?? 0);
      const totalLE = (aggFin.totalEquity ?? 0) + totalLiabilities;
      const diff = Math.abs(aggFin.totalAssets - totalLE);
      const balanced = diff <= Math.max(100, (aggFin.totalAssets ?? 0) * 0.01);
      bsRows.push(new TableRow({ children: [
        cell(para(txt(balanced ? "✓  Balance Check: BALANCED" : `⚠  Balance Check: MISMATCH  (Δ ${fmtInr(diff)})`, { font: "Times New Roman", size: 18, bold: true, color: balanced ? "1B6B4A" : "C04040" }), { spacing: { before: 80, after: 80 } }),
          { shading: { type: ShadingType.SOLID, color: balanced ? "EDF7F2" : "FDF2F2" }, borders: thinBorder, columnSpan: 3 }),
      ]}));
    }
    allSections.push(new Table({ rows: bsRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    allSections.push(blankLine());
  }

  // ═══════════════════════════════════════════════════════════════
  // PAGE 9 — CASH FLOW & WORKING CAPITAL
  // ═══════════════════════════════════════════════════════════════
  allSections.push(pageBreak());
  allSections.push(sectionHeader("5", "Cash Flow & Working Capital"));
  allSections.push(hrule(NAVY, 8));
  allSections.push(disclaimer(unit));
  allSections.push(blankLine());

  {
    const cfRow = (label, cur, prior, isTotal = false) => new TableRow({ children: [
      cell(para(txt(label, { font: "Times New Roman", size: 20, bold: isTotal, color: isTotal ? NAVY : DK }), { spacing: { before: 60, after: 60 } }),
        { shading: { type: ShadingType.SOLID, color: isTotal ? LIGHT : WHITE }, borders: thinBorder, width: { size: 55, type: WidthType.PERCENTAGE } }),
      cell(para(txt(fmtInr(cur), { font: "Times New Roman", size: 20, bold: isTotal, color: (cur != null && cur < 0) ? "C04040" : (isTotal ? NAVY : DK) }), { align: AlignmentType.RIGHT, spacing: { before: 60, after: 60 } }),
        { shading: { type: ShadingType.SOLID, color: isTotal ? LIGHT : WHITE }, borders: thinBorder, width: { size: 24, type: WidthType.PERCENTAGE } }),
      cell(para(txt(fmtInr(prior), { font: "Times New Roman", size: 20, color: MID }), { align: AlignmentType.RIGHT, spacing: { before: 60, after: 60 } }),
        { shading: { type: ShadingType.SOLID, color: isTotal ? LIGHT : WHITE }, borders: thinBorder, width: { size: 21, type: WidthType.PERCENTAGE } }),
    ]});

    const cfRows = [];
    cfRows.push(new TableRow({ tableHeader: true, children: [
      cell(para(txt("Cash Flow Summary", { font: "Times New Roman", size: 20, bold: true, color: WHITE }), { spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders }),
      cell(para(txt(companyInfo.period || "Current Year", { font: "Times New Roman", size: 20, bold: true, color: WHITE }), { align: AlignmentType.RIGHT, spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders }),
      cell(para(txt("Prior Year", { font: "Times New Roman", size: 20, bold: true, color: WHITE }), { align: AlignmentType.RIGHT, spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders }),
    ]}));
    if (aggFin.operatingCashFlow  != null) cfRows.push(cfRow("Cash Flow from Operations (CFO)", aggFin.operatingCashFlow,  aggPrior.operatingCashFlow,  true));
    if (aggFin.investingCashFlow  != null) cfRows.push(cfRow("Cash Flow from Investing (CFI)",  aggFin.investingCashFlow,  aggPrior.investingCashFlow));
    if (aggFin.financingCashFlow  != null) cfRows.push(cfRow("Cash Flow from Financing (CFF)",  aggFin.financingCashFlow,  aggPrior.financingCashFlow));
    if (aggFin.operatingCashFlow  != null && aggFin.investingCashFlow != null) {
      const fcf      = aggFin.operatingCashFlow  + aggFin.investingCashFlow;
      const fcfPrior = (aggPrior.operatingCashFlow != null && aggPrior.investingCashFlow != null)
        ? aggPrior.operatingCashFlow + aggPrior.investingCashFlow : null;
      cfRows.push(cfRow("Free Cash Flow  (CFO + CFI)", fcf, fcfPrior, true));
    }
    if (aggFin.cash != null) cfRows.push(cfRow("Closing Cash & Equivalents", aggFin.cash, aggPrior.cash));

    if (cfRows.length > 1) {
      allSections.push(new Table({ rows: cfRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
      allSections.push(blankLine());
    }

    // Working capital metrics from ratios
    const allRatioItems = (ratios || []).flatMap(cat => cat.items || []);
    const findR = (kw) => allRatioItems.find(it => (it.name || "").toLowerCase().includes(kw.toLowerCase()));
    const wcMetrics = [
      findR("DSO") || findR("Receivables Days"),
      findR("DIO") || findR("Inventory Days"),
      findR("DPO") || findR("Payable Days"),
      findR("Cash Conversion"),
      findR("Current Ratio"),
      findR("Quick Ratio"),
    ].filter(m => m && m.value !== "—");

    if (wcMetrics.length > 0) {
      allSections.push(subSectionHeader("Working Capital Metrics"));
      const wcRows = [];
      wcRows.push(new TableRow({ tableHeader: true, children: [
        cell(para(txt("Metric", { font: "Times New Roman", size: 19, bold: true, color: WHITE }), { spacing: { before: 60, after: 60 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders, width: { size: 40, type: WidthType.PERCENTAGE } }),
        cell(para(txt("Value", { font: "Times New Roman", size: 19, bold: true, color: WHITE }), { align: AlignmentType.CENTER, spacing: { before: 60, after: 60 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders, width: { size: 20, type: WidthType.PERCENTAGE } }),
        cell(para(txt("Formula", { font: "Times New Roman", size: 19, bold: true, color: WHITE }), { spacing: { before: 60, after: 60 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders, width: { size: 40, type: WidthType.PERCENTAGE } }),
      ]}));
      for (let wi = 0; wi < wcMetrics.length; wi++) {
        const m = wcMetrics[wi];
        const bg = wi % 2 === 0 ? LIGHT : WHITE;
        wcRows.push(new TableRow({ children: [
          cell(para(txt(m.name, { font: "Times New Roman", size: 20, bold: true, color: DK }), { spacing: { before: 60, after: 60 } }), { shading: { type: ShadingType.SOLID, color: bg }, borders: thinBorder }),
          cell(para(txt(m.value, { font: "Times New Roman", size: 20, bold: true, color: NAVY }), { align: AlignmentType.CENTER, spacing: { before: 60, after: 60 } }), { shading: { type: ShadingType.SOLID, color: bg }, borders: thinBorder }),
          cell(para(txt(m.formula || "—", { font: "Times New Roman", size: 17, italics: true, color: MID }), { spacing: { before: 60, after: 60 } }), { shading: { type: ShadingType.SOLID, color: bg }, borders: thinBorder }),
        ]}));
      }
      allSections.push(new Table({ rows: wcRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
      allSections.push(blankLine());
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PAGE 10 — RATIO ANALYSIS
  // ═══════════════════════════════════════════════════════════════
  if (ratios && ratios.length > 0) {
    allSections.push(pageBreak());
    allSections.push(sectionHeader("6", "Ratio Analysis"));
    allSections.push(hrule(NAVY, 8));
    allSections.push(disclaimer(unit));
    allSections.push(para(
      [txt("🟢 Within benchmark  🟡 Near benchmark  🔴 Outside benchmark  ⚪ No benchmark", { font: "Times New Roman", size: 20, italics: true, color: MID })],
      { align: AlignmentType.JUSTIFIED, spacing: { before: 100, after: 180 } }
    ));
    for (const category of ratios) {
      allSections.push(subheading(category.category));
      const ratioRows = [];
      ratioRows.push(new TableRow({ tableHeader: true, children: [
        cell(para(txt("", { font: "Times New Roman", size: 18 }), { spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders, width: { size: 5, type: WidthType.PERCENTAGE }, margins: { top: 100, bottom: 100, left: 80, right: 80 } }),
        cell(para(txt("Ratio", { font: "Times New Roman", size: 19, bold: true, color: WHITE }), { spacing: { before: 100, after: 100 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders, width: { size: 25, type: WidthType.PERCENTAGE } }),
        cell(para(txt("Value", { font: "Times New Roman", size: 19, bold: true, color: WHITE }), { align: AlignmentType.CENTER, spacing: { before: 100, after: 100 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders, width: { size: 13, type: WidthType.PERCENTAGE } }),
        cell(para(txt("Formula", { font: "Times New Roman", size: 19, bold: true, color: WHITE }), { spacing: { before: 100, after: 100 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders, width: { size: 27, type: WidthType.PERCENTAGE } }),
        cell(para(txt("Interpretation", { font: "Times New Roman", size: 19, bold: true, color: WHITE }), { spacing: { before: 100, after: 100 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders, width: { size: 30, type: WidthType.PERCENTAGE } }),
      ]}));
      for (let ri = 0; ri < category.items.length; ri++) {
        const item = category.items[ri];
        const isAlt = ri % 2 === 0;
        const lightEmoji = getRatioLight(item.name, item.rawValue);
        const bg = isAlt ? LIGHT : WHITE;
        ratioRows.push(new TableRow({ children: [
          cell(para(txt(lightEmoji, { font: "Times New Roman", size: 18 }), { align: AlignmentType.CENTER, spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: bg }, borders: thinBorder, width: { size: 5, type: WidthType.PERCENTAGE }, margins: { top: 80, bottom: 80, left: 60, right: 60 } }),
          cell(para(txt(item.name, { font: "Times New Roman", size: 20, bold: true, color: DK }), { spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: bg }, borders: thinBorder }),
          cell(para(txt(item.value, { font: "Times New Roman", size: 20, bold: true, color: item.value === "—" ? "999999" : NAVY }), { align: AlignmentType.CENTER, spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: bg }, borders: thinBorder }),
          cell(para(txt(item.formula, { font: "Times New Roman", size: 17, italics: true, color: MID }), { spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: bg }, borders: thinBorder }),
          cell(para(txt(item.interpretation, { font: "Times New Roman", size: 17, color: DK }), { spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: bg }, borders: thinBorder }),
        ]}));
      }
      allSections.push(new Table({ rows: ratioRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
      allSections.push(blankLine());
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PAGE 11 — SWOT ANALYSIS  (2×2 grid, 5 points per quadrant)
  // ═══════════════════════════════════════════════════════════════
  if (swot) {
    allSections.push(pageBreak());
    allSections.push(sectionHeader("7", "SWOT Analysis"));
    allSections.push(hrule(NAVY, 8));
    allSections.push(para(
      [txt(`Data-backed SWOT for ${companyInfo.name || "the Company"} derived from extracted financials.`, { font: "Times New Roman", size: 22, italics: true, color: MID })],
      { align: AlignmentType.JUSTIFIED, spacing: { before: 100, after: 200 } }
    ));

    const swotCellFn = (title, items, textColor, bgColor, borderColor) => {
      const children = [];
      children.push(para([txt(title, { font: "Times New Roman", size: 24, bold: true, color: textColor })],
        { align: AlignmentType.CENTER, spacing: { before: 180, after: 200 } }));
      const displayed = (items || []).filter(Boolean).slice(0, 5);
      if (displayed.length > 0) {
        for (const item of displayed) {
          children.push(para(
            [txt("●  ", { font: "Times New Roman", size: 20, bold: true, color: textColor }),
             txt(item.trim(), { font: "Times New Roman", size: 20, color: DK })],
            { spacing: { before: 100, after: 100, line: 340 }, indent: { left: 280, hanging: 200 } }
          ));
        }
      } else {
        children.push(para([txt("No data available from source filing.", { font: "Times New Roman", size: 19, italics: true, color: "999999" })], { align: AlignmentType.CENTER }));
      }
      return new TableCell({
        children,
        borders: {
          top:    { style: BorderStyle.SINGLE, size: 8, color: borderColor },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: "C5D3E8" },
          left:   { style: BorderStyle.SINGLE, size: 4, color: "C5D3E8" },
          right:  { style: BorderStyle.SINGLE, size: 4, color: "C5D3E8" },
        },
        shading: { type: ShadingType.SOLID, color: bgColor },
        margins: { top: 240, bottom: 240, left: 240, right: 240 },
        width: { size: 50, type: WidthType.PERCENTAGE },
        verticalAlign: "top",
      });
    };

    allSections.push(new Table({
      rows: [
        new TableRow({ children: [
          swotCellFn("STRENGTHS",    swot.strengths    || [], "1B6B4A", "EDF7F2", "1B6B4A"),
          swotCellFn("WEAKNESSES",   swot.weaknesses   || [], "C04040", "FDF2F2", "C04040"),
        ]}),
        new TableRow({ children: [
          swotCellFn("OPPORTUNITIES",swot.opportunities|| [], "1A5276", "EBF5FB", "1A5276"),
          swotCellFn("THREATS",      swot.threats      || [], "884400", "FFF8EE", "B7860F"),
        ]}),
      ],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }));
    allSections.push(blankLine());
  }

  // ═══════════════════════════════════════════════════════════════
  // PAGE 12 — RISK REGISTER, 12-MONTH OUTLOOK & CONCLUSION
  // ═══════════════════════════════════════════════════════════════
  allSections.push(pageBreak());
  allSections.push(sectionHeader("8", "Risk Assessment & Outlook"));
  allSections.push(hrule(NAVY, 8));
  allSections.push(blankLine());

  {
    const threatList = (swot?.threats || []).filter(Boolean);
    const PROB_CYCLE   = ["Medium","High","Low","Medium","High"];
    const IMPACT_CYCLE = ["High","High","Medium","High","Medium"];
    const risks = threatList.length > 0
      ? threatList.slice(0, 5).map((t, i) => ({
          risk:       t.trim().substring(0, 100),
          prob:       PROB_CYCLE[i % 5],
          impact:     IMPACT_CYCLE[i % 5],
          mitigation: "Active monitoring and management controls in place. Refer to Directors' Report for detail.",
        }))
      : [
          { risk: "Revenue concentration / customer dependency",  prob: "Medium", impact: "High",   mitigation: "Diversify customer base and product portfolio to reduce single-client exposure." },
          { risk: "Input cost inflation and margin compression",   prob: "High",   impact: "Medium", mitigation: "Long-term supply agreements and backward integration initiatives." },
          { risk: "Regulatory and compliance risk (MCA/SEBI)",    prob: "Low",    impact: "High",   mitigation: "Robust compliance framework, internal audit and independent board oversight." },
          { risk: "Liquidity and working capital stress",          prob: "Medium", impact: "High",   mitigation: "Credit facilities, receivables management and cash flow monitoring." },
        ];

    const riskRows = [];
    riskRows.push(new TableRow({ tableHeader: true, children: [
      cell(para(txt("Risk Factor",  { font: "Times New Roman", size: 19, bold: true, color: WHITE }), { spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders, width: { size: 34, type: WidthType.PERCENTAGE } }),
      cell(para(txt("Probability",  { font: "Times New Roman", size: 19, bold: true, color: WHITE }), { align: AlignmentType.CENTER, spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders, width: { size: 14, type: WidthType.PERCENTAGE } }),
      cell(para(txt("Impact",       { font: "Times New Roman", size: 19, bold: true, color: WHITE }), { align: AlignmentType.CENTER, spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders, width: { size: 14, type: WidthType.PERCENTAGE } }),
      cell(para(txt("Mitigation",   { font: "Times New Roman", size: 19, bold: true, color: WHITE }), { spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: NAVY }, borders: noBorders, width: { size: 38, type: WidthType.PERCENTAGE } }),
    ]}));
    for (let ri = 0; ri < risks.length; ri++) {
      const r = risks[ri];
      const bg = ri % 2 === 0 ? LIGHT : WHITE;
      const probColor   = r.prob   === "High" ? "C04040" : (r.prob   === "Medium" ? "884400" : "1B6B4A");
      const impactColor = r.impact === "High" ? "C04040" : (r.impact === "Medium" ? "884400" : "1B6B4A");
      riskRows.push(new TableRow({ children: [
        cell(para(txt(r.risk,       { font: "Times New Roman", size: 19, color: DK }), { spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: bg }, borders: thinBorder }),
        cell(para(txt(r.prob,       { font: "Times New Roman", size: 19, bold: true, color: probColor }),   { align: AlignmentType.CENTER, spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: bg }, borders: thinBorder }),
        cell(para(txt(r.impact,     { font: "Times New Roman", size: 19, bold: true, color: impactColor }), { align: AlignmentType.CENTER, spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: bg }, borders: thinBorder }),
        cell(para(txt(r.mitigation, { font: "Times New Roman", size: 18, color: MID }), { spacing: { before: 80, after: 80 } }), { shading: { type: ShadingType.SOLID, color: bg }, borders: thinBorder }),
      ]}));
    }
    allSections.push(new Table({ rows: riskRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    allSections.push(blankLine());

    // 12-month outlook callout
    allSections.push(subSectionHeader("12-Month Outlook"));
    const execOutlookTxt = swot?.executiveOutlook || "";
    const outlookContent = execOutlookTxt
      ? fullClean(execOutlookTxt.trim()).substring(0, 800)
      : `${companyInfo.name || "The Company"} is positioned within the ${companyInfo.sector || "corporate"} sector with an established operational track record. Over the next 12 months, management is expected to focus on revenue growth, margin improvement and working capital optimisation. Key monitorables include revenue trajectory, debt reduction progress and operating cash flow generation. Stakeholders should track quarterly filings for updated guidance and material developments.`;
    allSections.push(new Table({
      rows: [new TableRow({ children: [new TableCell({
        children: [para([txt(outlookContent, { font: "Times New Roman", size: 21, color: DK })], { align: AlignmentType.JUSTIFIED, spacing: { before: 120, after: 120, line: 340 } })],
        shading: { type: ShadingType.SOLID, color: LIGHT },
        borders: { top: { style: BorderStyle.SINGLE, size: 12, color: NAVY }, bottom: noBorder, left: noBorder, right: noBorder },
        margins: { top: 200, bottom: 200, left: 240, right: 240 },
      })] })],
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideH: noBorder, insideV: noBorder },
    }));
    allSections.push(blankLine());

    // Conclusion
    allSections.push(subSectionHeader("Conclusion"));
    allSections.push(para(
      [txt(`This financial analysis report for ${companyInfo.name || "the Company"} has been prepared using AI-assisted extraction and analysis of the source filing. The data covers ${companyInfo.period || "the reported period"} and is derived from official company documents. Investors and stakeholders should conduct their own due diligence and consult qualified financial advisers before making any investment or business decisions. FinSight AI does not warrant the completeness or accuracy of the underlying source data.`, { font: "Times New Roman", size: 22, color: DK })],
      { align: AlignmentType.JUSTIFIED, spacing: { before: 120, after: 200, line: 340 } }
    ));

    // Disclaimer box
    allSections.push(hrule("C5D3E8", 6));
    allSections.push(new Table({
      rows: [new TableRow({ children: [new TableCell({
        children: [
          para([txt("DISCLAIMER", { font: "Times New Roman", size: 20, bold: true, color: NAVY })], { spacing: { before: 80, after: 80 } }),
          para([txt("This report is generated by FinSight AI for informational purposes only. It does not constitute investment advice, a solicitation, or an offer to purchase or sell any security. Financial data is extracted from public filings using AI; verify figures against primary sources. Past performance is not indicative of future results.", { font: "Times New Roman", size: 18, italics: true, color: MID })], { align: AlignmentType.JUSTIFIED, spacing: { before: 60, after: 80, line: 320 } }),
          para([txt(`© ${new Date().getFullYear()} FinSight AI  •  finsightai.org  •  Prepared by ${AUTHOR_NAME}`, { font: "Times New Roman", size: 16, color: MID })], { align: AlignmentType.CENTER, spacing: { before: 40, after: 80 } }),
        ],
        shading: { type: ShadingType.SOLID, color: "F7FAFF" },
        borders: thinBorder,
        margins: { top: 160, bottom: 160, left: 200, right: 200 },
      })] })],
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideH: noBorder, insideV: noBorder },
    }));
  }


  // (Structured pages 4-12 generated above — legacy duplicate sections removed)
  const docTitle = `${companyInfo.name || "Private Company"} - Financial Analysis Report`;
  const doc = new Document({
    creator: 'FinSight AI',
    title: docTitle,
    description: 'Goldman Sachs-style financial analysis report with ratios, SWOT, and charts',
    subject: 'Financial Analysis Report',
    keywords: 'financial-statements,MCA,XBRL,ratios,SWOT,FinSight',
    styles: { default: { document: { run: { font: "Times New Roman", size: 22 }, paragraph: { spacing: { line: 320 } } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1100, right: 1100, bottom: 1100, left: 1100, header: 700, footer: 700 },
          borders: {
            pageBorderTop:    { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 24 },
            pageBorderRight:  { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 24 },
            pageBorderBottom: { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 24 },
            pageBorderLeft:   { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 24 },
          }
        }
      },
      headers: {
        default: new Header({
          children: [
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: { top: noBorder, bottom: { style: BorderStyle.SINGLE, size: 4, color: "C5D3E8" }, left: noBorder, right: noBorder, insideH: noBorder, insideV: noBorder },
              rows: [new TableRow({
                children: [
                  new TableCell({
                    width: { size: 60, type: WidthType.PERCENTAGE },
                    borders: noBorders,
                    children: [new Paragraph({ children: [new TextRun({ text: companyInfo.name || "FinSight AI", bold: true, size: 16, color: NAVY, font: "Times New Roman" })], spacing: { before: 0, after: 60 } })],
                  }),
                  new TableCell({
                    width: { size: 40, type: WidthType.PERCENTAGE },
                    borders: noBorders,
                    children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "FinSight AI", italics: true, size: 16, color: MID, font: "Times New Roman" })], spacing: { before: 0, after: 60 } })],
                  }),
                ]
              })]
            })
          ]
        })
      },
      footers: {
        default: new Footer({
          children: [
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: { top: { style: BorderStyle.SINGLE, size: 4, color: "C5D3E8" }, bottom: noBorder, left: noBorder, right: noBorder, insideH: noBorder, insideV: noBorder },
              rows: [new TableRow({
                children: [
                  new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    borders: noBorders,
                    children: [new Paragraph({ children: [new TextRun({ text: "finsightai.org", size: 15, color: MID, font: "Times New Roman" })], spacing: { before: 60, after: 0 } })],
                  }),
                  new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    borders: noBorders,
                    children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Page ", size: 15, color: MID, font: "Times New Roman" }), new TextRun({ children: [PageNumber.CURRENT], size: 15, color: NAVY, font: "Times New Roman" }), new TextRun({ text: " of ", size: 15, color: MID, font: "Times New Roman" }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 15, color: NAVY, font: "Times New Roman" })], spacing: { before: 60, after: 0 } })],
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

  // Portrait: 595.28 - 56*2 = 483pt  Landscape: 841.89 - 56*2 = 729pt
  const CW_PORTRAIT = 483;
  const CW_LANDSCAPE = 729;
  const CW = CW_PORTRAIT;
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

  // ── PROCESSING NOTICE (subtle, title-page level) ────────────────────────────
  const noticeChunk = chunkResults.find(cr => cr.chunkSummary === "Processing notice");
  if (noticeChunk) {
    const noticeText = noticeChunk.blocks?.[0]?.paragraphs?.[0] || '';
    if (noticeText) {
      content.push({
        text: noticeText.replace(/^NOTE:\s*/i, 'Processing notice: '),
        fontSize: 9, italics: true, color: '#A8761F', alignment: 'center',
        margin: [50, 20, 50, 30]
      });
    }
  }

  // ── MAIN CONTENT SECTIONS ───────────────────────────────────────────────────
  const seenHeadings = new Set();
  const headingKey = (num, title) => `${(num || '').toLowerCase()}::${humanizeTitle(title || '').toLowerCase()}`;
  let currentSectionTitle = '';

  const pushSectionHeader = (num, title) => {
    content.push({
      text: `${num ? num + ' ' : ''}${humanizeTitle(title)}`,
      fontSize: 16, bold: true, color: BROWN, alignment: 'center',
      pageBreak: 'before', margin: [0, 0, 0, 10]
    });
  };

  for (const chunkResult of chunkResults) {
    if (!chunkResult.blocks || chunkResult.blocks.length === 0) continue;
    if (chunkResult.chunkSummary === "Processing notice") continue;
    const hasMeaningfulContent = chunkResult.blocks.some(b =>
      ['paragraph_block', 'table', 'key_value_table', 'bullet_list'].includes(b.type)
    );
    if (!hasMeaningfulContent) continue;
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
          content.push({ table: { widths: [CW * 0.42, CW * 0.58], dontBreakRows: true, body: rows }, layout: tableLayout, margin: [0, 4, 0, 10] });
        }

      } else if (block.type === 'table' && block.headers && block.headers.length > 0) {
        if (block.title) content.push({ text: humanizeTitle(block.title), fontSize: 11, bold: true, color: BROWN, margin: [0, 8, 0, 3] });
        const numCols = block.headers.length;
        const useLandscape = numCols >= 6;
        const activeCW = useLandscape ? CW_LANDSCAPE : CW_PORTRAIT;
        const fs = numCols >= 7 ? 8 : numCols >= 5 ? 8 : 10;
        const pad = numCols >= 5 ? 2 : 3;
        const firstW = numCols >= 5 ? activeCW * 0.24 : activeCW * 0.34;
        const restW = (activeCW - firstW) / Math.max(1, numCols - 1);
        const widths = [firstW, ...Array(numCols - 1).fill(restW)];

        const headerRow = block.headers.map(h => ({
          text: fullClean(String(h || '')), bold: true, color: BROWN, fillColor: LIGHT_BG,
          fontSize: fs, alignment: 'center', margin: [pad, pad, pad, pad], noWrap: false
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
              margin: [pad, pad, pad, pad], noWrap: false
            }));
          });

        if (bodyRows.length > 0) {
          const tableObj = { table: { widths, headerRows: 1, dontBreakRows: true, body: [headerRow, ...bodyRows] }, layout: tableLayout, margin: [0, 4, 0, 10] };
          content.push(useLandscape ? { ...tableObj, pageOrientation: 'landscape' } : tableObj);
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
        { text: label, bold: true, fontSize: 12, color: textColor, alignment: 'center', margin: [0, 4, 0, 8] },
        ...(items && items.length > 0
          ? items.map(s => ({ text: `•  ${s.trim()}`, fontSize: 9, color: textColor, lineHeight: 1.4, margin: [8, 1, 0, 1] }))
          : [{ text: 'No data available', fontSize: 9, italics: true, color: '#999999', alignment: 'center' }])
      ],
      margin: [6, 6, 6, 6]
    });

    content.push({ unbreakable: true, stack: [{ table: { widths: [CW / 2, CW / 2], dontBreakRows: true, body: [[swotCell('STRENGTHS', swot.strengths, '#2D7D5C', '#F0FAF5'), swotCell('WEAKNESSES', swot.weaknesses, '#C04040', '#FDF2F2')]] }, layout: tableLayout, margin: [0, 0, 0, 6] }] });
    content.push({ unbreakable: true, stack: [{ table: { widths: [CW / 2, CW / 2], dontBreakRows: true, body: [[swotCell('OPPORTUNITIES', swot.opportunities, '#3B82B0', '#F0F6FC'), swotCell('THREATS', swot.threats, '#A8761F', '#FEF7E6')]] }, layout: tableLayout, margin: [0, 0, 0, 14] }] });

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
  const docId = Math.random().toString(36).substring(2, 10).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
  const generatedDate = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  content.push({ text: '', pageBreak: 'before', margin: [0, 60, 0, 0] });
  content.push({ canvas: [{ type: 'rect', x: CW * 0.2, y: 0, w: CW * 0.6, h: 2, color: BROWN }], margin: [0, 0, 0, 20] });
  content.push({ text: 'Document Information', fontSize: 14, bold: true, color: BROWN, alignment: 'center', margin: [0, 0, 0, 16] });
  content.push({
    table: {
      widths: [CW * 0.35, CW * 0.65],
      dontBreakRows: true,
      body: [
        [{ text: 'Generated by', bold: true, fontSize: 10, margin: [4, 4, 4, 4] }, { text: 'FinSight AI', fontSize: 10, margin: [4, 4, 4, 4] }],
        [{ text: 'Authors', bold: true, fontSize: 10, margin: [4, 4, 4, 4] }, { text: AUTHOR_NAME, fontSize: 10, margin: [4, 4, 4, 4] }],
        [{ text: 'Date Generated', bold: true, fontSize: 10, margin: [4, 4, 4, 4] }, { text: generatedDate, fontSize: 10, margin: [4, 4, 4, 4] }],
        [{ text: 'Document ID', bold: true, fontSize: 10, margin: [4, 4, 4, 4] }, { text: docId, fontSize: 10, color: '#666666', margin: [4, 4, 4, 4] }],
        [{ text: 'Company', bold: true, fontSize: 10, margin: [4, 4, 4, 4] }, { text: companyInfo.name || 'Private Company', fontSize: 10, margin: [4, 4, 4, 4] }],
      ]
    },
    layout: tableLayout,
    margin: [CW * 0.1, 0, CW * 0.1, 20]
  });
  content.push({ canvas: [{ type: 'rect', x: CW * 0.2, y: 0, w: CW * 0.6, h: 2, color: BROWN }], margin: [0, 0, 0, 24] });
  content.push({ text: 'Visit finsightai.org for more AI-powered financial analysis tools', fontSize: 11, italics: true, color: BROWN, alignment: 'center', margin: [0, 0, 0, 16] });
  content.push({ text: 'This document was generated from publicly available filings. For informational purposes only. Does not constitute investment advice.', fontSize: 9, italics: true, color: '#999999', alignment: 'center', margin: [40, 0, 40, 0] });

  // ── DOCUMENT DEFINITION ──────────────────────────────────────────────────────
  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [56, 80, 56, 56],
    background: (currentPage, pageSize) => ({
      canvas: [{
        type: 'rect',
        x: 24, y: 24,
        w: pageSize.width - 48, h: pageSize.height - 48,
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
        margin: [56, 32, 56, 2]
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

// ─── BRIEF COMPANY NOTE ─────────────────────────────────────────────────────

function getFallbackNarrative(companyInfo, aggregated, swot) {
  const toStrArr = (arr) => (Array.isArray(arr) ? arr : []).filter(s => typeof s === 'string');
  return {
    aboutCompany: {
      type: companyInfo.sector || 'Business Operations',
      headquarters: null,
      overview: `${companyInfo.name} operates in the ${companyInfo.sector || 'business'} sector. This brief presents key financial highlights and analysis from the company's filing for ${companyInfo.period || 'the reporting period'}.`,
      coreOfferings: []
    },
    keyInsights: toStrArr(swot?.strengths).slice(0, 4).map(s => s.replace(/^[•\-]\s*/, '').slice(0, 150)).filter(Boolean),
    financialNarrative: swot?.executiveOutlook || 'See financial highlights table for detailed metrics.',
    businessModel: {
      coreModel: `${companyInfo.name} generates revenue through its core operations in ${companyInfo.sector || 'its industry'}.`,
      revenueDrivers: [],
      valueProposition: ''
    },
    keyDifferentiators: toStrArr(swot?.strengths).slice(0, 3).map(s => s.replace(/^[•\-]\s*/, '').slice(0, 80)).filter(Boolean),
    risks: toStrArr(swot?.weaknesses).slice(0, 3).map(s => s.replace(/^[•\-]\s*/, '').slice(0, 150)).filter(Boolean),
    summary: swot?.executiveOutlook || `${companyInfo.name} — financial brief based on available filing data.`
  };
}

function generateRuleBasedSWOT(companyInfo, aggregated, aggregatedPrior, ratios) {
  const strengths = [], weaknesses = [], opportunities = [], threats = [];

  const getItemVal = (categoryName, itemName) => {
    const cat = ratios.find(r => r.category === categoryName);
    return cat?.items.find(i => i.name === itemName)?.rawValue ?? null;
  };

  const netMargin    = getItemVal('Profitability Ratios', 'Net Margin');
  const grossMargin  = getItemVal('Profitability Ratios', 'Gross Margin');
  const ebitdaMargin = getItemVal('Profitability Ratios', 'EBITDA Margin');
  const roe          = getItemVal('Profitability Ratios', 'Return on Equity (ROE)');
  const debtEquity   = getItemVal('Leverage Ratios', 'Debt-to-Equity');
  const interestCov  = getItemVal('Leverage Ratios', 'Interest Coverage');
  const currentRatio = getItemVal('Liquidity Ratios', 'Current Ratio');
  const revGrowth    = (aggregated.revenue && aggregatedPrior?.revenue && aggregatedPrior.revenue !== 0)
    ? ((aggregated.revenue - aggregatedPrior.revenue) / Math.abs(aggregatedPrior.revenue)) * 100
    : null;

  const fmt1 = (v) => v.toFixed(1);
  const fmt2 = (v) => v.toFixed(2);
  const unit = companyInfo.rounding || 'Lakhs';

  // Strengths
  if (netMargin != null && netMargin > 10)   strengths.push(`Strong net profitability at ${fmt1(netMargin)}% net margin reflects efficient cost management`);
  if (grossMargin != null && grossMargin > 40) strengths.push(`High gross margin of ${fmt1(grossMargin)}% indicates strong pricing power and/or low input costs`);
  if (revGrowth != null && revGrowth > 15)   strengths.push(`Revenue grew ${fmt1(revGrowth)}% year-over-year to ${aggregated.revenue?.toLocaleString()} ${unit}, showing strong demand momentum`);
  if (currentRatio != null && currentRatio > 1.5) strengths.push(`Healthy liquidity position with current ratio of ${fmt2(currentRatio)}x provides short-term financial flexibility`);
  if (debtEquity != null && debtEquity < 0.5) strengths.push(`Conservative capital structure with D/E ratio of ${fmt2(debtEquity)}x leaves capacity for strategic borrowing`);
  if (roe != null && roe > 15)              strengths.push(`Return on equity of ${fmt1(roe)}% demonstrates effective use of shareholder capital`);
  if (interestCov != null && interestCov > 5) strengths.push(`Interest coverage of ${fmt2(interestCov)}x indicates comfortable debt servicing capacity`);

  // Weaknesses
  if (netMargin != null && netMargin < 5 && netMargin >= 0) weaknesses.push(`Thin net margins at ${fmt1(netMargin)}% leave limited buffer against revenue or cost shocks`);
  if (netMargin != null && netMargin < 0) weaknesses.push(`Net loss reported — operations are not yet profitable at bottom line`);
  if (debtEquity != null && debtEquity > 2)  weaknesses.push(`High financial leverage with D/E ratio of ${fmt2(debtEquity)}x increases vulnerability to interest rate rises`);
  if (currentRatio != null && currentRatio < 1) weaknesses.push(`Current ratio below 1.0 (${fmt2(currentRatio)}x) signals potential short-term liquidity pressure`);
  if (revGrowth != null && revGrowth < 0)    weaknesses.push(`Revenue declined ${fmt1(Math.abs(revGrowth))}% year-over-year — top-line pressure warrants monitoring`);
  if (interestCov != null && interestCov < 2) weaknesses.push(`Low interest coverage of ${fmt2(interestCov)}x — limited headroom for debt servicing under stress`);

  // Opportunities (sector-aware)
  const nameLower = (companyInfo.name || '').toLowerCase();
  const sectorLower = (companyInfo.sector || '').toLowerCase();
  if (sectorLower.includes('medical') || sectorLower.includes('pharma') || nameLower.includes('health')) {
    opportunities.push('India\'s expanding healthcare infrastructure and rising insurance penetration support medium-term demand growth');
    opportunities.push('Export opportunities to regulated markets (US FDA, CE) could diversify revenue and improve realisations');
  } else if (sectorLower.includes('tech') || sectorLower.includes('software') || sectorLower.includes('it')) {
    opportunities.push('Digital transformation spending across industries creates sustained demand for technology services');
    opportunities.push('Global delivery model expansion could increase addressable market and margin profile');
  } else {
    opportunities.push('Growing domestic consumption and formalisation of the economy support sector tailwinds');
    opportunities.push('Operational digitalisation and process efficiency improvements could structurally improve margins');
  }
  if (revGrowth != null && revGrowth > 10) opportunities.push('Existing growth momentum positions the company well to gain further market share');
  opportunities.push('Strategic partnerships or distribution network expansion could accelerate geographic reach');

  // Threats
  threats.push('Rising input and employee costs could compress margins if not offset by pricing or productivity gains');
  threats.push('Competitive intensity from both organised domestic players and international entrants');
  if (debtEquity != null && debtEquity > 1) threats.push('Interest rate increases would elevate finance costs given current leverage, pressuring net income');
  threats.push('Regulatory changes, GST implications, or policy shifts in the operating environment could add compliance cost');

  // Ensure minimums
  if (!strengths.length) strengths.push(`${companyInfo.name || 'The company'} has an established operating track record with documented financial performance`);
  if (!weaknesses.length) weaknesses.push('Full AI analysis unavailable — manual review of ratios above is recommended');

  const rev = aggregated.revenue;
  const ni  = aggregated.netIncome;
  const outlook = `${companyInfo.name || 'The company'} reported revenue of ${rev != null ? rev.toLocaleString() + ' ' + unit : 'N/A'} with a net ${ni != null && ni < 0 ? 'loss' : 'income'} of ${ni != null ? Math.abs(ni).toLocaleString() + ' ' + unit : 'N/A'} for ${companyInfo.period || 'the period'}. `
    + (revGrowth != null ? `Revenue ${revGrowth >= 0 ? 'grew' : 'declined'} ${fmt1(Math.abs(revGrowth))}% year-over-year. ` : '')
    + 'Note: AI narrative is temporarily unavailable — this assessment is rule-based from extracted financial ratios.';

  return {
    strengths: strengths.slice(0, 5),
    weaknesses: weaknesses.slice(0, 5),
    opportunities: opportunities.slice(0, 4),
    threats: threats.slice(0, 4),
    executiveOutlook: outlook,
    ratioInterpretations: [],
    _rulesBased: true,
  };
}

function queuePendingAnalysis(companyInfo, aggregated, aggregatedPrior, ratios, swot) {
  try {
    const key = 'finsight_pending_analyses';
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    existing.push({
      id: Date.now(),
      companyName: companyInfo.name || 'Unknown Company',
      queuedAt: new Date().toISOString(),
      companyInfo,
      aggregated,
      aggregatedPrior,
      ratios,
      swot,
    });
    localStorage.setItem(key, JSON.stringify(existing.slice(-5)));
  } catch (e) {
    console.warn('[PendingQueue] Failed to save:', e);
  }
}

function getPendingAnalyses() {
  try { return JSON.parse(localStorage.getItem('finsight_pending_analyses') || '[]'); }
  catch { return []; }
}

function removePendingAnalysis(id) {
  try {
    const existing = JSON.parse(localStorage.getItem('finsight_pending_analyses') || '[]');
    localStorage.setItem('finsight_pending_analyses', JSON.stringify(existing.filter(p => p.id !== id)));
  } catch { /* ignore */ }
}

async function generateBriefNarrative(companyInfo, aggregated, aggregatedPrior, ratios, swot, chunkResults) {
  const contextSnippets = (chunkResults || []).slice(0, 3)
    .flatMap(c => (c.blocks || []).filter(b => b.type === 'paragraph_block').map(b => (b.paragraphs || []).join(' ')))
    .filter(Boolean).join('\n\n').slice(0, 4000);

  const profCat = ratios.find(c => c.category === 'Profitability Ratios');
  const unit = companyInfo.rounding || 'Lakhs';
  const finSnap = [
    `Company: ${companyInfo.name}`, `Period: ${companyInfo.period}`,
    `Sector: ${companyInfo.sector || 'N/A'}`,
    `Revenue (current yr): ${aggregated.revenue ?? 'N/A'} ${unit}`,
    `Revenue (prior yr):   ${aggregatedPrior.revenue ?? 'N/A'} ${unit}`,
    `Net Income: ${aggregated.netIncome ?? 'N/A'} ${unit}`,
    `Gross Margin: ${profCat?.items.find(i => i.name === 'Gross Margin')?.value ?? 'N/A'}`,
    `Net Margin:   ${profCat?.items.find(i => i.name === 'Net Margin')?.value ?? 'N/A'}`,
    `Total Assets: ${aggregated.totalAssets ?? 'N/A'} ${unit}`,
    `LT Debt: ${aggregated.longTermDebt ?? 'N/A'} ${unit}`,
    `ST Debt: ${aggregated.shortTermDebt ?? 'N/A'} ${unit}`,
  ].join('\n');

  const userMsg = `You are writing a brief company research note for CAs and senior analysts in India. Tone: concise, analytical, specific — like a Bloomberg brief or an initiation note.

FINANCIAL SNAPSHOT:
${finSnap}

FILING EXCERPTS (first 3 sections):
${contextSnippets}

EXECUTIVE OUTLOOK: ${swot?.executiveOutlook || 'N/A'}
KEY STRENGTHS: ${(swot?.strengths || []).slice(0, 3).join(' | ')}
KEY CONCERNS: ${(swot?.weaknesses || []).slice(0, 3).join(' | ')}

Return ONLY this JSON (no markdown, no text outside braces):
{
  "aboutCompany": {
    "type": "1-line business type (e.g. 'Medical Devices Distributor')",
    "headquarters": "City, State if extractable from filing, else null",
    "overview": "2-3 sentence business description specific to this company",
    "coreOfferings": ["offering 1","offering 2","offering 3","offering 4"]
  },
  "keyInsights": [
    "Specific observation with actual number (max 25 words)",
    "Specific observation with actual number (max 25 words)",
    "Specific observation with actual number (max 25 words)",
    "Specific observation with actual number (max 25 words)"
  ],
  "financialNarrative": "Single paragraph max 80 words interpreting financial highlights with 2-3 specific numbers and balanced analytical tone",
  "businessModel": {
    "coreModel": "1 sentence on how the company makes money",
    "revenueDrivers": ["driver 1","driver 2","driver 3"],
    "valueProposition": "1-2 sentences on competitive positioning"
  },
  "keyDifferentiators": ["Differentiator 1 (max 15 words)","Differentiator 2","Differentiator 3"],
  "risks": ["Risk 1 with number if relevant (max 25 words)","Risk 2","Risk 3"],
  "summary": "3-paragraph summary separated by \\n\\n. P1: Company positioning and FY performance. P2: Key insight about financial health. P3: Forward-looking framing. Each paragraph max 50 words."
}
Rules: Use INR/₹, not USD. Include real numbers. Return null for genuinely unavailable sections. Do NOT invent facts.`;

  let raw;
  try {
    raw = await callClaude({
      system: 'You are a senior financial analyst writing research notes for Indian private companies. Output valid JSON only.',
      userMsg, maxTokens: 3000
    });
  } catch (e) {
    if (e.apiUnavailable) {
      console.warn('[BriefNarrative] API unavailable — using fallback narrative');
      return getFallbackNarrative(companyInfo, aggregated, swot);
    }
    throw e;
  }

  const extractJSON = (text) => {
    if (!text) return null;
    try { return JSON.parse(text); } catch { /* continue */ }
    let cleaned = text.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(cleaned); } catch { /* continue */ }
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch { /* continue */ } }
    const fixed = (match ? match[0] : cleaned)
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'");
    try { return JSON.parse(fixed); } catch (e) {
      console.error('[BriefNarrative] All JSON parse strategies failed:', { original: text.slice(0, 300), error: e.message });
      return null;
    }
  };

  const parsed = extractJSON(raw);
  if (!parsed) {
    console.warn('[BriefNarrative] Using fallback narrative');
    return getFallbackNarrative(companyInfo, aggregated, swot);
  }
  return parsed;
}

async function generateBriefWordDoc(chunkResults, companyInfo, aggregated, aggregatedPrior, ratios, swot, briefNarrative) {
  const docx = await loadDocx();
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    BorderStyle, AlignmentType, WidthType, PageNumber, Header, Footer, ShadingType,
  } = docx;
  const levelBulletFmt = (docx.LevelFormat || {}).BULLET || 'bullet';

  // ── Palette ──────────────────────────────────────────────────────────────
  const BROWN = "8B4513", DK = "4A4A4A", MID = "888888";
  const BROWN_BG = "F5EFE7", WHITE = "FFFFFF", ALT = "FAFAFA";
  const BORD = { top: { style: BorderStyle.SINGLE, size: 4, color: "D3D3D3" }, bottom: { style: BorderStyle.SINGLE, size: 4, color: "D3D3D3" }, left: { style: BorderStyle.SINGLE, size: 4, color: "D3D3D3" }, right: { style: BorderStyle.SINGLE, size: 4, color: "D3D3D3" } };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const run = (text, o = {}) => new TextRun({ text: String(text ?? ''), font: 'Calibri', size: o.size || 22, bold: o.bold || false, italics: o.italics || false, color: o.color || DK });
  const pg = (children, o = {}) => new Paragraph({ children: Array.isArray(children) ? children : [children], alignment: o.align || AlignmentType.LEFT, spacing: o.sp || { before: 80, after: 80, line: 280 }, ...(o.num ? { numbering: { reference: 'bb', level: 0 } } : {}), ...(o.brk ? { pageBreakBefore: true } : {}) });
  const h1 = (txt, brk = false) => pg([run(txt, { size: 32, bold: true, color: BROWN })], { sp: { before: 280, after: 140, line: 360 }, brk });
  const h2 = (txt) => pg([run(txt, { size: 24, bold: true, color: BROWN })], { sp: { before: 180, after: 100, line: 320 } });
  const body = (txt, o = {}) => pg([run(txt, { size: 22, ...o })], { sp: { before: 60, after: 60, line: 288 } });
  const kv = (label, val) => pg([run(`${label}: `, { size: 22, bold: true }), run(val || '—', { size: 22 })], { sp: { before: 50, after: 50, line: 276 } });
  const bullet = (txt) => pg([run(txt, { size: 22 })], { sp: { before: 40, after: 40, line: 280 }, num: true });
  const blank = () => pg([run('')], { sp: { before: 60, after: 60 } });
  const hr = () => new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E8E1D8' } }, spacing: { before: 100, after: 100 } });

  const tc = (kids, o = {}) => new TableCell({ children: Array.isArray(kids) ? kids : [kids], borders: BORD, width: o.w, shading: o.shd, margins: { top: 80, bottom: 80, left: 120, right: 120 } });

  // ── Number helpers ────────────────────────────────────────────────────────
  const fn = (v) => { if (v == null) return '—'; const a = Math.abs(v); const s = a.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return v < 0 ? `(${s})` : s; };
  const fp = (v) => v == null ? '—' : v < 0 ? `(${Math.abs(v).toFixed(2)}%)` : `${v.toFixed(2)}%`;
  const yoy = (c, p) => (c != null && p != null && p !== 0) ? fp(((c - p) / Math.abs(p)) * 100) : '—';

  // FY labels
  const fyL = (() => {
    const m = (companyInfo.period || '').match(/\b(20\d{2})\b/g);
    if (m?.length >= 2) { const [a, b] = m.slice(-2); return { cur: `FY ${a.slice(-2)}-${b.slice(-2)}`, pri: `FY ${(+a - 1).toString().slice(-2)}-${a.slice(-2)}` }; }
    return { cur: 'Current', pri: 'Prior' };
  })();

  // ── Director / auditor extraction ─────────────────────────────────────────
  const people = (() => {
    const dirs = []; let aud = null;
    for (const chunk of chunkResults) {
      for (const blk of (chunk.blocks || [])) {
        const tl = (blk.title || '').toLowerCase();
        if (/director|leadership|management|board/.test(tl)) {
          (blk.pairs || []).forEach(pr => { if (pr.label && pr.value && !/date|din|pan|cin|address/i.test(pr.label)) dirs.push(`${pr.value} — ${pr.label}`); });
          (blk.rows || []).forEach(r => { if (r.length >= 2 && !/^\d+$/.test(r[0]) && r[0].length > 3) dirs.push(`${r[0]} — ${r[1]}`); });
        }
        if (/auditor/.test(tl)) {
          const pr = (blk.pairs || []).find(p => /name|firm/i.test(p.label));
          if (pr) aud = pr.value;
        }
        if (!aud) {
          const txt = (blk.paragraphs || []).join(' ');
          const mx = txt.match(/(?:Statutory\s+Auditor|Auditor)[^:\n]*:\s*([A-Z][^,\n.]{5,60}(?:LLP|CA|Associates|Partners|&\s*Co))/i);
          if (mx) aud = mx[1].trim();
        }
      }
    }
    return { dirs: [...new Set(dirs)].slice(0, 8), aud };
  })();

  // CIN / incorporation year
  const cin = (() => {
    const txt = chunkResults.map(c => JSON.stringify(c.blocks || [])).join(' ');
    const m = txt.match(/CIN\s*[:\s]*([ULF][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6})/i);
    return m ? m[1] : null;
  })();
  const incYear = cin ? cin.slice(5, 9) : null;

  // Smart-skip flags
  const allTxt = chunkResults.map(c => JSON.stringify(c.blocks || [])).join(' ');
  const hasSubs = /subsidiar|holding\s+compan|associate\s+compan/i.test(allTxt);
  const hasHistory = !!(cin || incYear || hasSubs);

  const nb = (briefNarrative && typeof briefNarrative === 'object' && !Array.isArray(briefNarrative))
    ? briefNarrative : getFallbackNarrative(companyInfo, aggregated, swot);
  const about = (nb.aboutCompany && typeof nb.aboutCompany === 'object') ? nb.aboutCompany : {};

  // ── Ratios lookup ─────────────────────────────────────────────────────────
  const getR = (cat, name) => ratios.find(c => c.category === cat)?.items.find(i => i.name === name);
  const dso = getR('Efficiency Ratios', 'Receivables Days (DSO)');
  const dpo = getR('Efficiency Ratios', 'Payable Days (DPO)');
  const invT = getR('Efficiency Ratios', 'Inventory Turnover');

  const ebitdaM = (c, p) => (c != null && p != null && p !== 0) ? (c / p) * 100 : null;
  const wc = (a) => a.workingCapital ?? (a.currentAssets != null && a.currentLiabilities != null ? a.currentAssets - a.currentLiabilities : null);

  // ── Financial highlights table ────────────────────────────────────────────
  const finRows = [
    { L: 'Revenue',                c: aggregated.revenue,       p: aggregatedPrior.revenue },
    { L: 'COGS',                   c: aggregated.cogs,          p: aggregatedPrior.cogs },
    { L: 'EBITDA',                 c: aggregated.ebitda,        p: aggregatedPrior.ebitda },
    { L: 'EBITDA Margin (%)',      c: ebitdaM(aggregated.ebitda, aggregated.revenue), p: ebitdaM(aggregatedPrior.ebitda, aggregatedPrior.revenue), isPct: true, noYoy: true },
    { L: 'Net Income (After Tax)', c: aggregated.netIncome,     p: aggregatedPrior.netIncome },
    { L: 'Trade Receivables',      c: aggregated.receivables,   p: aggregatedPrior.receivables },
    { L: 'Receivable Days (DSO)',  c: dso?.rawValue, p: null, isDays: true, noYoy: true },
    { L: 'Trade Payables',         c: aggregated.tradePayables, p: aggregatedPrior.tradePayables },
    { L: 'Payable Days (DPO)',     c: dpo?.rawValue, p: null, isDays: true, noYoy: true },
    { L: 'Short-term Borrowings',  c: aggregated.shortTermDebt, p: aggregatedPrior.shortTermDebt },
    { L: 'Long-term Borrowings',   c: aggregated.longTermDebt,  p: aggregatedPrior.longTermDebt },
    { L: 'Inventory',              c: aggregated.inventory,     p: aggregatedPrior.inventory },
    { L: 'Inventory Turnover',     c: invT?.rawValue, p: null, isMult: true, noYoy: true },
    { L: 'Working Capital',        c: wc(aggregated),           p: wc(aggregatedPrior) },
  ].filter(r => r.c != null || r.p != null).map(r => ({
    ...r,
    cs: r.isPct ? fp(r.c) : r.isDays ? (r.c != null ? `${r.c.toFixed(0)} days` : '—') : r.isMult ? (r.c != null ? `${r.c.toFixed(2)}x` : '—') : fn(r.c),
    ps: r.isPct ? fp(r.p) : r.isDays ? '—' : r.isMult ? '—' : fn(r.p),
    ys: r.noYoy ? '—' : yoy(r.c, r.p),
  }));

  const CW = [{ size: 47, type: WidthType.PERCENTAGE }, { size: 18, type: WidthType.PERCENTAGE }, { size: 18, type: WidthType.PERCENTAGE }, { size: 17, type: WidthType.PERCENTAGE }];
  const hdrShd = { fill: BROWN, type: ShadingType.CLEAR, color: 'auto' };
  const tblHdr = new TableRow({ tableHeader: true, children: [
    tc([pg([run('Particulars', { size: 20, bold: true, color: WHITE })], { sp: { before: 60, after: 60 } })], { w: CW[0], shd: hdrShd }),
    tc([pg([run(fyL.pri, { size: 20, bold: true, color: WHITE })], { align: AlignmentType.RIGHT, sp: { before: 60, after: 60 } })], { w: CW[1], shd: hdrShd }),
    tc([pg([run(fyL.cur, { size: 20, bold: true, color: WHITE })], { align: AlignmentType.RIGHT, sp: { before: 60, after: 60 } })], { w: CW[2], shd: hdrShd }),
    tc([pg([run('YoY %', { size: 20, bold: true, color: WHITE })], { align: AlignmentType.RIGHT, sp: { before: 60, after: 60 } })], { w: CW[3], shd: hdrShd }),
  ]});
  const tblBody = finRows.map((r, i) => {
    const bg = i % 2 === 0 ? WHITE : ALT;
    const shd = { fill: bg, type: ShadingType.CLEAR, color: 'auto' };
    const rsp = { before: 60, after: 60 };
    return new TableRow({ children: [
      tc([pg([run(r.L, { size: 20 })], { sp: rsp })], { w: CW[0], shd }),
      tc([pg([run(r.ps, { size: 20 })], { align: AlignmentType.RIGHT, sp: rsp })], { w: CW[1], shd }),
      tc([pg([run(r.cs, { size: 20 })], { align: AlignmentType.RIGHT, sp: rsp })], { w: CW[2], shd }),
      tc([pg([run(r.ys, { size: 20 })], { align: AlignmentType.RIGHT, sp: rsp })], { w: CW[3], shd }),
    ]});
  });
  const finTable = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [tblHdr, ...tblBody] });

  // ── Build document children ───────────────────────────────────────────────
  const ch = [];

  // ── Title page ────────────────────────────────────────────────────────────
  ch.push(pg([run('')], { sp: { before: 900, after: 0 } }));
  ch.push(pg([run(companyInfo.name || 'Private Company', { size: 52, bold: true, color: BROWN })], { align: AlignmentType.CENTER, sp: { before: 200, after: 200, line: 560 } }));
  ch.push(pg([run('Company Brief', { size: 30, italics: true, color: DK })], { align: AlignmentType.CENTER, sp: { before: 100, after: 100 } }));
  if (companyInfo.period) ch.push(pg([run(`Reporting Period: ${companyInfo.period}`, { size: 22, color: MID })], { align: AlignmentType.CENTER, sp: { before: 80, after: 60 } }));
  ch.push(pg([run('Prepared by FinSight AI  ·  finsightai.org', { size: 20, italics: true, color: MID })], { align: AlignmentType.CENTER, sp: { before: 200, after: 60 } }));
  ch.push(pg([run(`Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, { size: 20, color: MID })], { align: AlignmentType.CENTER, sp: { before: 60, after: 240 } }));
  ch.push(hr());
  ch.push(pg([run('This document is generated from MCA/XBRL filings using FinSight AI. For informational purposes only. Not investment advice.', { size: 16, italics: true, color: MID })], { align: AlignmentType.CENTER, sp: { before: 100, after: 0 } }));

  // ── About the Company ─────────────────────────────────────────────────────
  ch.push(h1('About the Company', true));
  if (about.type)          ch.push(kv('Business Type', about.type));
  if (companyInfo.sector)  ch.push(kv('Sector', companyInfo.sector));
  if (about.headquarters)  ch.push(kv('Headquarters', about.headquarters));
  if (cin)                 ch.push(kv('CIN', cin));
  if (companyInfo.period)  ch.push(kv('Reporting Period', companyInfo.period));
  if (companyInfo.rounding) ch.push(kv('Financial Unit', `${companyInfo.rounding} of ${companyInfo.currency || 'INR'}`));
  if (about.overview)      { ch.push(blank()); ch.push(body(about.overview)); }
  if (Array.isArray(about.coreOfferings) && about.coreOfferings.length) {
    ch.push(blank());
    ch.push(pg([run('Core Offerings', { size: 22, bold: true })], { sp: { before: 100, after: 60 } }));
    about.coreOfferings.forEach(o => ch.push(bullet(o)));
  }

  // ── Key Insights ──────────────────────────────────────────────────────────
  if (Array.isArray(nb.keyInsights) && nb.keyInsights.length) {
    ch.push(h1('Key Insights', true));
    nb.keyInsights.forEach(ins => ch.push(bullet(ins)));
  }

  // ── Financial Highlights ──────────────────────────────────────────────────
  ch.push(h1('Financial Highlights', true));
  ch.push(pg([run(`Values in ${companyInfo.rounding || 'Lakhs'} of ${companyInfo.currency || 'INR'}`, { size: 20, italics: true, color: MID })], { sp: { before: 40, after: 140 } }));
  ch.push(finTable);
  if (nb.financialNarrative) { ch.push(blank()); ch.push(body(nb.financialNarrative, { italics: true })); }

  // ── Promoters & Leadership ────────────────────────────────────────────────
  if (people.dirs.length > 0 || people.aud) {
    ch.push(h1('Promoters & Leadership', true));
    if (people.dirs.length > 0) {
      ch.push(pg([run('Board of Directors / Key Management', { size: 22, bold: true })], { sp: { before: 80, after: 60 } }));
      people.dirs.forEach(d => ch.push(bullet(d)));
    }
    if (people.aud) { ch.push(blank()); ch.push(kv('Statutory Auditor', people.aud)); }
    if (incYear)     ch.push(kv('Year of Incorporation', `${incYear} (per CIN)`));
  }

  // ── Business Model ────────────────────────────────────────────────────────
  if (nb.businessModel && typeof nb.businessModel === 'object') {
    const bm = nb.businessModel;
    ch.push(h1('Business Model', true));
    if (bm.coreModel) ch.push(body(bm.coreModel));
    if (Array.isArray(bm.revenueDrivers) && bm.revenueDrivers.length) {
      ch.push(blank());
      ch.push(pg([run('Revenue Drivers', { size: 22, bold: true })], { sp: { before: 80, after: 60 } }));
      bm.revenueDrivers.forEach(d => ch.push(bullet(d)));
    }
    if (bm.valueProposition) { ch.push(blank()); ch.push(h2('Value Proposition')); ch.push(body(bm.valueProposition)); }
  }

  // ── Key Differentiators ───────────────────────────────────────────────────
  if (Array.isArray(nb.keyDifferentiators) && nb.keyDifferentiators.length) {
    ch.push(h1('Key Differentiators', true));
    nb.keyDifferentiators.forEach(d => ch.push(bullet(d)));
  }

  // ── Company History ───────────────────────────────────────────────────────
  if (hasHistory) {
    ch.push(h1('Company History & Structure', true));
    if (cin)    ch.push(kv('Company Identification Number', cin));
    if (incYear) ch.push(body(`Incorporated in ${incYear} as per CIN registration records.`));
    if (hasSubs) { ch.push(blank()); ch.push(body('The company has subsidiaries, associates, or related group entities. Refer to the Notes to Financial Statements for the full group structure.')); }
  }

  // ── Risks & Outlook ───────────────────────────────────────────────────────
  ch.push(h1('Risks & Outlook', true));
  if (Array.isArray(nb.risks) && nb.risks.length) { ch.push(h2('Key Risks')); nb.risks.forEach(r => ch.push(bullet(r))); }
  if (Array.isArray(swot?.threats) && swot.threats.length) { ch.push(blank()); ch.push(h2('External Threats')); swot.threats.slice(0, 3).forEach(th => ch.push(bullet(th))); }
  if (swot?.executiveOutlook) { ch.push(blank()); ch.push(h2('Outlook')); ch.push(body(swot.executiveOutlook)); }

  // ── Summary ───────────────────────────────────────────────────────────────
  if (nb.summary) {
    ch.push(h1('Summary', true));
    const paras = String(nb.summary).split(/\n\n+/).filter(Boolean);
    paras.forEach((par, i) => { ch.push(body(par)); if (i < paras.length - 1) ch.push(blank()); });
  }

  // ── Header / Footer ───────────────────────────────────────────────────────
  const docHeader = new Header({ children: [
    new Paragraph({ alignment: AlignmentType.LEFT, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E8E1D8' } }, spacing: { before: 0, after: 80 },
      children: [new TextRun({ text: companyInfo.name || 'Company Brief', font: 'Calibri', size: 18, italics: true, color: MID })] }),
  ]});
  const docFooter = new Footer({ children: [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 0 }, children: [
      new TextRun({ text: 'FinSight AI  ·  Page ', font: 'Calibri', size: 18, color: MID }),
      new TextRun({ children: [PageNumber.CURRENT], font: 'Calibri', size: 18, color: MID }),
      new TextRun({ text: ' of ', font: 'Calibri', size: 18, color: MID }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Calibri', size: 18, color: MID }),
      new TextRun({ text: '  ·  finsightai.org', font: 'Calibri', size: 18, color: MID }),
    ]}),
  ]});

  const doc = new Document({
    title: `${companyInfo.name || 'Company'} - Company Brief`,
    subject: 'Brief company analysis',
    creator: 'FinSight AI',
    keywords: 'company brief, financial analysis, India',
    numbering: {
      config: [{
        reference: 'bb',
        levels: [{
          level: 0, format: levelBulletFmt, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } }, run: { font: 'Symbol', size: 20 } },
        }],
      }],
    },
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }, size: { height: 16838, width: 11906 } } },
      headers: { default: docHeader },
      footers: { default: docFooter },
      children: ch,
    }],
  });

  // Packer.toBase64String uses JSZip's 'base64' output type, which works in every
  // browser without touching Node.js Buffer. We then decode it with atob() and pack
  // into a Uint8Array before wrapping in a Blob — pure browser APIs throughout.
  const base64 = await Packer.toBase64String(doc);
  const byteStr = atob(base64);
  const bytes = new Uint8Array(byteStr.length);
  for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
  const blob = new Blob([bytes.buffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  // Filename: FinSight_BBraun_FY24-25_CompanyBrief.docx
  const slug = (companyInfo.name || 'Company').replace(/\b(Private|Pvt|Limited|Ltd|Public|Inc|Corp|Company|Co|LLP|Group|Holdings)\b/gi, '').replace(/[^a-zA-Z0-9 ]/g, '').trim().split(/\s+/).slice(0, 4).join('_').substring(0, 25) || 'Company';
  const ym = (companyInfo.period || '').match(/\b(20\d{2})\b/g);
  const fyTag = ym?.length >= 2 ? `_FY${ym[ym.length - 2].slice(-2)}-${ym[ym.length - 1].slice(-2)}` : '';
  const fileName = `FinSight_${slug}${fyTag}_CompanyBrief.docx`;

  return { blob, fileName, pageCount: 12 };
}

function validateExtractedData(agg) {
  try {
    const { years, sortedYears } = wrapAggToYears(agg, null);
    const vRes = validateFinancialData(years, sortedYears);
    const all = [...vRes.errors, ...vRes.warnings];
    if (all.length > 0) console.warn('[FinSight] Extraction warnings:', all);
    return all;
  } catch (e) {
    return [];
  }
}

function hasAnyFinancialData(agg) {
  if (!agg) return false;
  const criticalFields = ['revenue', 'totalAssets', 'totalLiabilities', 'totalEquity', 'netIncome'];
  return criticalFields.some(field => agg[field] != null && agg[field] !== 0);
}

// ─── Scanned PDF → Excel Pipeline ────────────────────────────────────────────

const VISION_FINANCIAL_PROMPT = `Extract ALL financial data visible in these financial statement pages.
Return ONLY valid JSON — no markdown, no explanation, no code fences:
{
  "company_name": null,
  "currency": "INR",
  "unit": "Lakhs",
  "years": {
    "FY2024": {
      "profit_loss": {
        "revenue": null, "other_income": null, "total_income": null,
        "cost_of_goods": null, "employee_costs": null, "finance_costs": null,
        "depreciation": null, "other_expenses": null, "total_expenses": null,
        "pbt": null, "tax": null, "net_income": null, "ebitda": null
      },
      "balance_sheet": {
        "share_capital": null, "reserves": null, "total_equity": null,
        "long_term_debt": null, "short_term_debt": null, "total_debt": null,
        "trade_payables": null, "other_current_liabilities": null, "total_liabilities": null,
        "fixed_assets": null, "intangibles": null, "investments": null,
        "trade_receivables": null, "inventory": null, "cash": null,
        "current_assets": null, "total_assets": null
      },
      "cash_flow": {
        "cfo": null, "cfi": null, "cff": null, "net_change_in_cash": null, "closing_cash": null
      },
      "ratios": {
        "eps": null, "book_value_per_share": null, "dividend_per_share": null
      }
    }
  }
}
Rules:
- Detect fiscal year from column headers (e.g. "March 2024" or "2023-24" → "FY2024", "2022-23" → "FY2023")
- If multiple years appear in same table, create a key for each year
- All values as plain numbers matching the document's stated unit (Lakhs/Crores/Millions/Thousands)
- Negative values as negative numbers (e.g. losses)
- Missing or illegible data → null (never use 0 unless the document explicitly states zero)
- Detect currency from document header (INR/USD/EUR/GBP)
- Detect unit from document (Lakhs/Crores/Millions/Thousands) — default Lakhs if unclear`;

async function callClaudeVisionForFinancials(pageImages) {
  const content = [
    ...pageImages.map(img => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: img.base64 }
    })),
    { type: 'text', text: VISION_FINANCIAL_PROMPT }
  ];
  const body = { model: MODEL, max_tokens: 4000, messages: [{ role: 'user', content }] };
  const RETRYABLE = new Set([429, 503, 529]);
  for (let attempt = 1; attempt <= 4; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000);
    let res;
    try {
      res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') { if (attempt > 3) throw new Error('Vision financial extraction timed out'); continue; }
      throw err;
    }
    clearTimeout(timeoutId);
    if (RETRYABLE.has(res.status)) {
      if (attempt > 3) throw new Error('Rate limit on vision financial extraction');
      await new Promise(r => setTimeout(r, 60000 * attempt));
      continue;
    }
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'Vision financial API failed');
    return json.content.filter(b => b.type === 'text').map(b => b.text).join('');
  }
}

function mergeFinancialYearData(base, incoming) {
  if (!incoming) return base;
  const merged = { ...base };
  for (const [section, data] of Object.entries(incoming)) {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      merged[section] = merged[section] ? { ...merged[section] } : {};
      for (const [key, val] of Object.entries(data)) {
        if (merged[section][key] == null && val != null) {
          merged[section][key] = val;
        }
      }
    } else if (merged[section] == null && data != null) {
      merged[section] = data;
    }
  }
  return merged;
}

// ─── Tesseract-only financial extraction pipeline (no Claude API) ─────────

function parseIndianNum(s) {
  if (!s) return null;
  s = String(s).trim();
  const neg = (s.startsWith('(') && s.endsWith(')')) || /^[-−]/.test(s);
  s = s.replace(/[()₹Rs.,\s−]/g, '').replace(/^-/, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : neg ? -n : n;
}

function numsAfterPos(line, pos) {
  const slice = pos > 0 ? line.slice(pos) : line;
  const out = [];
  for (const m of slice.matchAll(/\([\d,]+(?:\.\d+)?\)|[-−]?\s*[\d,]+(?:\.\d+)?/g)) {
    const n = parseIndianNum(m[0]);
    if (n === null) continue;
    const a = Math.abs(n);
    if (Number.isInteger(a) && a >= 1985 && a <= 2040) continue; // year-shaped integer
    if (Number.isInteger(a) && a < 10) continue;                 // page-number-sized integer
    out.push(n);
  }
  return out;
}

const METRIC_DEFS = [
  { key: 'revenue',             section: 'profit_loss',   include: [/revenue\s+from\s+oper|net\s+(?:revenue|sales)|turnover|gross\s+revenue/i],                    exclude: [/other\s+(?:income|revenue)/i] },
  { key: 'other_income',        section: 'profit_loss',   include: [/\bother\s+income\b/i] },
  { key: 'gross_profit',        section: 'profit_loss',   include: [/\bgross\s+profit\b/i] },
  { key: 'ebitda',              section: 'profit_loss',   include: [/\bebitda\b/i] },
  { key: 'ebit',                section: 'profit_loss',   include: [/\bebit\b(?!da)/i, /operating\s+profit/i],                                                      exclude: [/ebitda/i] },
  { key: 'depreciation',        section: 'profit_loss',   include: [/depreciation|amortis/i] },
  { key: 'interest_expense',    section: 'profit_loss',   include: [/finance\s+cost|interest\s+(?:expense|paid|on\s+loan)|borrowing\s+cost/i] },
  { key: 'pbt',                 section: 'profit_loss',   include: [/profit\s+before\s+tax|\bpbt\b/i] },
  { key: 'tax_expense',         section: 'profit_loss',   include: [/(?:total\s+)?tax\s+expense|income\s+tax\s+expense|provision\s+for\s+tax/i],                   exclude: [/deferred\s+tax\s+(?:asset|liab)/i] },
  { key: 'net_income',          section: 'profit_loss',   include: [/profit\s+(?:for\s+the\s+(?:year|period)|after\s+tax)|net\s+profit\s+after|net\s+income|\bpat\b/i], exclude: [/before\s+tax/i] },
  { key: 'total_assets',        section: 'balance_sheet', include: [/\btotal\s+assets\b/i] },
  { key: 'current_assets',      section: 'balance_sheet', include: [/total\s+current\s+assets/i] },
  { key: 'non_current_assets',  section: 'balance_sheet', include: [/total\s+non.?current\s+assets/i] },
  { key: 'fixed_assets',        section: 'balance_sheet', include: [/(?:net\s+block|property,?\s+plant\s+and\s+equip|tangible\s+assets)/i] },
  { key: 'cash_and_equivalents',section: 'balance_sheet', include: [/cash\s+and\s+(?:cash\s+)?equivalents|cash\s+and\s+bank/i] },
  { key: 'total_equity',        section: 'balance_sheet', include: [/total\s+equity|(?:shareholders?|stockholders?)[\s'’]*(?:equity|funds)|net\s+worth/i] },
  { key: 'total_liabilities',   section: 'balance_sheet', include: [/\btotal\s+liabilities\b/i],                                                                    exclude: [/current\s+liabilities/i] },
  { key: 'current_liabilities', section: 'balance_sheet', include: [/total\s+current\s+liabilities/i] },
  { key: 'total_debt',          section: 'balance_sheet', include: [/total\s+(?:long.?term\s+)?borrowing|total\s+debt/i] },
  { key: 'cfo',                 section: 'cash_flow',     include: [/cash\s+(?:from|generated\s+(?:by|from)|used\s+in)\s+operating|(?:net\s+cash\s+)?operating\s+activities/i] },
  { key: 'cfi',                 section: 'cash_flow',     include: [/cash\s+(?:from|used\s+in)\s+investing|(?:net\s+cash\s+)?investing\s+activities/i] },
  { key: 'cff',                 section: 'cash_flow',     include: [/cash\s+(?:from|used\s+in)\s+financing|(?:net\s+cash\s+)?financing\s+activities/i] },
  { key: 'net_change_in_cash',  section: 'cash_flow',     include: [/net\s+(?:change|increase|decrease)\s+in\s+cash|net\s+cash\s+(?:flow|position)/i] },
];

function detectYearsFromText(text) {
  const found = new Map();
  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    for (const m of line.matchAll(/\bFY\s*(\d{4})\b/gi))
      if (!found.has(`FY${m[1]}`)) found.set(`FY${m[1]}`, li);
    // 2023-24 → FY2024
    for (const m of line.matchAll(/\b(20\d{2})-(\d{2})\b/g)) {
      const yr = `FY${2000 + parseInt(m[2], 10)}`;
      if (!found.has(yr)) found.set(yr, li);
    }
    // 2023-2024
    for (const m of line.matchAll(/\b20\d{2}-(20\d{2})\b/g))
      if (!found.has(`FY${m[1]}`)) found.set(`FY${m[1]}`, li);
    // March 2024 / 31st March 2024
    for (const m of line.matchAll(/\bMarch\s+(?:\d{1,2}[,\s]+)?(20\d{2})\b/gi))
      if (!found.has(`FY${m[1]}`)) found.set(`FY${m[1]}`, li);
    // 31.03.2024 / 31/03/2024
    for (const m of line.matchAll(/\b31[./]0?3[./](20\d{2})\b/g))
      if (!found.has(`FY${m[1]}`)) found.set(`FY${m[1]}`, li);
  }
  // Most-recent year first
  return [...found.keys()].sort((a, b) => parseInt(b.slice(2), 10) - parseInt(a.slice(2), 10));
}

function detectUnitFromText(text) {
  if (/\b(?:in\s+)?crore|\bCr\.?\b/i.test(text)) return 'Crores';
  if (/\b(?:in\s+)?lakh|\bLk\.?\b/i.test(text)) return 'Lakhs';
  return 'Lakhs';
}

function detectCurrencyFromText(text) {
  if (/\bUSD\b|\$/.test(text)) return 'USD';
  if (/\bGBP\b|£/.test(text)) return 'GBP';
  return 'INR';
}

function detectCompanyNameFromText(lines) {
  for (const line of lines.slice(0, 30)) {
    if (line.length > 5 && line.length < 100 && /(?:limited|ltd\.?|private|pvt\.?|llp|inc\.?|corp\.?)\b/i.test(line))
      return line.replace(/\s+/g, ' ').trim();
  }
  return null;
}

function parseFinancialsFromText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const detectedYears = detectYearsFromText(text);
  const unit = detectUnitFromText(text);
  const currency = detectCurrencyFromText(text);
  const companyName = detectCompanyNameFromText(lines);

  const currentYear = detectedYears[0] || `FY${new Date().getFullYear()}`;
  const priorYear = detectedYears[1] || null;

  const yearsData = {};
  yearsData[currentYear] = { profit_loss: {}, balance_sheet: {}, cash_flow: {}, ratios: {} };
  if (priorYear) yearsData[priorYear] = { profit_loss: {}, balance_sheet: {}, cash_flow: {}, ratios: {} };

  for (const def of METRIC_DEFS) {
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const lLine = line.toLowerCase();
      if (!def.include.some(p => p.test(lLine))) continue;
      if (def.exclude?.some(p => p.test(lLine))) continue;

      let kwEnd = 0;
      for (const p of def.include) {
        const m = lLine.match(p);
        if (m) kwEnd = Math.max(kwEnd, (m.index ?? 0) + m[0].length);
      }

      let nums = numsAfterPos(line, kwEnd);
      // Look-ahead: values sometimes appear on the next line
      if (nums.length === 0 && li + 1 < lines.length)
        nums = numsAfterPos(lines[li + 1], 0);

      if (nums.length === 0) continue;

      if (nums[0] != null) yearsData[currentYear][def.section][def.key] = nums[0];
      if (nums[1] != null && priorYear) yearsData[priorYear][def.section][def.key] = nums[1];
      break; // first matching line wins per metric
    }
  }

  return { years: yearsData, company_name: companyName, currency, unit };
}

async function extractFinancialsWithTesseract(file, onProgress) {
  const pdfjs = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();

  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('password') || msg.includes('encrypt')) throw new Error('PASSWORD_PROTECTED');
    throw new Error('CORRUPT_PDF');
  }

  const totalPages = pdf.numPages;
  const pageMetadata = [];
  const allPageText = new Array(totalPages).fill('');
  const ocrQueue = []; // { idx, canvas, pageNum }

  // Layer 1 + 2: Text extraction and per-page scanned detection
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    onProgress?.(`📄 Reading PDF pages... (${pageNum}/${totalPages})`);
    const page = await pdf.getPage(pageNum);

    let textLayerText = '';
    try {
      const content = await page.getTextContent();
      textLayerText = content.items.map(item => item.str).join(' ');
    } catch (_) { /* text layer unavailable */ }

    const hasText = textLayerText.trim().length > 500;
    const hasNumbers = /\d{3,}/.test(textLayerText);

    if (hasText && hasNumbers) {
      // Layer 1 fast path: digital text is usable
      allPageText[pageNum - 1] = textLayerText;
      pageMetadata.push({ page: pageNum, method: 'text', chars: textLayerText.length });
    } else {
      // Layer 2: scanned — rasterize at scale 3.0 ≈ 300 DPI (assumes 96 DPI screen baseline)
      console.log(`[Tesseract] Page ${pageNum}: scanned (~${textLayerText.trim().length} chars), queuing OCR`);
      try {
        const canvas = await renderPdfPageToCanvas(page, 3.0);
        ocrQueue.push({ idx: pageNum - 1, canvas, pageNum });
        pageMetadata.push({ page: pageNum, method: 'ocr-queued' });
      } catch (renderErr) {
        allPageText[pageNum - 1] = textLayerText;
        pageMetadata.push({ page: pageNum, method: 'render-failed', chars: textLayerText.length });
      }
    }
  }

  // Layer 3: Single shared Tesseract worker for all scanned pages
  if (ocrQueue.length > 0) {
    onProgress?.(`🔍 Detected ${ocrQueue.length} scanned page(s) — starting OCR...`);
    const Tesseract = await loadTesseract();
    let worker = null;
    try {
      worker = await Tesseract.createWorker('eng', 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js',
      });
      for (let q = 0; q < ocrQueue.length; q++) {
        const { idx, canvas, pageNum } = ocrQueue[q];
        onProgress?.(`🔍 OCR page ${pageNum} of ${totalPages} (${q + 1}/${ocrQueue.length})...`);
        try {
          const { data } = await worker.recognize(canvas);
          allPageText[idx] = data.text || '';
          const meta = pageMetadata.find(m => m.page === pageNum);
          if (meta) { meta.method = 'ocr'; meta.confidence = Math.round(data.confidence); }
        } catch (ocrErr) {
          console.warn(`[Tesseract] OCR failed page ${pageNum}:`, ocrErr.message);
          const meta = pageMetadata.find(m => m.page === pageNum);
          if (meta) meta.method = 'ocr-failed';
        }
      }
    } catch (workerErr) {
      console.error('[Tesseract] Worker init failed:', workerErr.message);
      onProgress?.('⚠ OCR engine unavailable — financial data extraction may be limited');
    } finally {
      try { await worker?.terminate(); } catch (_) {}
    }
  }

  const combinedText = allPageText.join('\n\n');
  onProgress?.('📊 Parsing financial data from extracted text...');

  // Layer 4: Regex-based financial parser — no Claude API required
  const parsed = parseFinancialsFromText(combinedText);
  const sortedYears = Object.keys(parsed.years).sort();

  for (const yr of sortedYears) onProgress?.(`✅ ${yr} data extracted`);

  // Layer 5: Validation
  const vResult5 = validateFinancialData(parsed.years, sortedYears);
  const validationWarnings = [...vResult5.errors, ...vResult5.warnings];

  if (validationWarnings.length > 0) {
    validationWarnings.forEach(w => console.warn('[Tesseract Validation]', w));
    onProgress?.(`⚠ ${validationWarnings.length} validation issue(s) flagged — see Excel warnings sheet`);
  } else if (sortedYears.length > 0) {
    onProgress?.('✅ Financial data validated successfully');
  }

  return {
    years: parsed.years,
    company_name: parsed.company_name,
    currency: parsed.currency,
    unit: parsed.unit,
    pageMetadata,
    totalPages,
    validationWarnings,
    extractionMethod: 'tesseract',
  };
}

function validateFinancialData(years, sortedYears) {
  const errors = [];
  const warnings = [];
  const rowFlags = {}; // { yr: { section: { field: 'error'|'warning' } } }

  function flag(yr, section, field, type) {
    if (!rowFlags[yr]) rowFlags[yr] = {};
    if (!rowFlags[yr][section]) rowFlags[yr][section] = {};
    if (rowFlags[yr][section][field] !== 'error') rowFlags[yr][section][field] = type;
  }

  // Year-level: chronological order, duplicates, gap detection
  const seen = new Set();
  for (const yr of sortedYears) {
    if (seen.has(yr)) errors.push(`Duplicate year: ${yr}`);
    seen.add(yr);
  }
  for (let i = 1; i < sortedYears.length; i++) {
    const pn = parseInt(sortedYears[i - 1].replace(/\D/g, '').slice(-4));
    const cn = parseInt(sortedYears[i].replace(/\D/g, '').slice(-4));
    if (!isNaN(pn) && !isNaN(cn)) {
      if (cn < pn) errors.push(`Years out of order: ${sortedYears[i - 1]} appears before ${sortedYears[i]}`);
      else if (cn - pn > 1) warnings.push(`Year gap: missing data between ${sortedYears[i - 1]} and ${sortedYears[i]}`);
    }
  }

  // Per-year checks
  let cfoNegStreak = 0;
  for (const yr of sortedYears) {
    const data = years[yr];
    if (!data) continue;
    const bs = data.balance_sheet || {};
    const pl = data.profit_loss || {};
    const cf = data.cash_flow || {};

    // Balance sheet equation: Assets = L + E (±5%)
    if (bs.total_assets != null && bs.total_liabilities != null && bs.total_equity != null) {
      const lpe = (bs.total_liabilities || 0) + (bs.total_equity || 0);
      if (bs.total_assets !== 0) {
        const diff = Math.abs((bs.total_assets - lpe) / bs.total_assets);
        if (diff > 0.05) {
          errors.push(`[${yr}] Balance sheet equation fails: Assets=${bs.total_assets} ≠ L+E=${lpe.toFixed(0)} (${(diff * 100).toFixed(1)}% gap)`);
          flag(yr, 'balance_sheet', 'total_assets', 'error');
          flag(yr, 'balance_sheet', 'total_liabilities', 'error');
          flag(yr, 'balance_sheet', 'total_equity', 'error');
        }
      }
    }

    // Current < total checks
    if (bs.current_assets != null && bs.total_assets != null && bs.current_assets > bs.total_assets) {
      errors.push(`[${yr}] Current assets (${bs.current_assets}) exceed total assets (${bs.total_assets})`);
      flag(yr, 'balance_sheet', 'current_assets', 'error');
    }
    if (bs.current_liabilities != null && bs.total_liabilities != null && bs.current_liabilities > bs.total_liabilities) {
      errors.push(`[${yr}] Current liabilities (${bs.current_liabilities}) exceed total liabilities (${bs.total_liabilities})`);
      flag(yr, 'balance_sheet', 'current_liabilities', 'error');
    }

    // P&L: no negative revenue
    if (pl.revenue != null && pl.revenue < 0) {
      errors.push(`[${yr}] Negative revenue (${pl.revenue}) — likely extraction error`);
      flag(yr, 'profit_loss', 'revenue', 'error');
    }

    // P&L: PBT waterfall (PBT ≈ NI + tax, ±5%)
    if (pl.pbt != null && pl.net_income != null && pl.tax_expense != null) {
      const computed = pl.net_income + pl.tax_expense;
      if (pl.pbt !== 0 && Math.abs((pl.pbt - computed) / Math.abs(pl.pbt)) > 0.05) {
        warnings.push(`[${yr}] PBT waterfall mismatch: PBT=${pl.pbt} vs NI+Tax=${computed.toFixed(0)}`);
        flag(yr, 'profit_loss', 'pbt', 'warning');
        flag(yr, 'profit_loss', 'tax_expense', 'warning');
        flag(yr, 'profit_loss', 'net_income', 'warning');
      }
    }

    // P&L: net margin outside [-50%, +80%]
    if (pl.revenue != null && pl.revenue > 0 && pl.net_income != null) {
      const margin = pl.net_income / pl.revenue;
      if (margin < -0.5) {
        warnings.push(`[${yr}] Very negative net margin (${(margin * 100).toFixed(1)}%) — verify extraction`);
        flag(yr, 'profit_loss', 'net_income', 'warning');
      } else if (margin > 0.8) {
        warnings.push(`[${yr}] Unusually high net margin (${(margin * 100).toFixed(1)}%) — verify extraction`);
        flag(yr, 'profit_loss', 'net_income', 'warning');
      }
    }

    // Cash flow: CFO+CFI+CFF ≈ net change (±10%)
    if (cf.cfo != null && cf.cfi != null && cf.cff != null && cf.net_change_in_cash != null && cf.net_change_in_cash !== 0) {
      const computed = (cf.cfo || 0) + (cf.cfi || 0) + (cf.cff || 0);
      const diff = Math.abs(computed - cf.net_change_in_cash) / Math.abs(cf.net_change_in_cash);
      if (diff > 0.1) {
        warnings.push(`[${yr}] CF components sum to ${computed.toFixed(0)} vs stated net change ${cf.net_change_in_cash}`);
        flag(yr, 'cash_flow', 'net_change_in_cash', 'warning');
      }
    }

    // Multi-year: CFO negative streak
    if (cf.cfo != null) {
      if (cf.cfo < 0) {
        cfoNegStreak++;
        if (cfoNegStreak >= 3) flag(yr, 'cash_flow', 'cfo', 'warning');
      } else {
        cfoNegStreak = 0;
      }
    }
  }
  if (cfoNegStreak >= 3) warnings.push(`CFO has been negative for ${cfoNegStreak} consecutive years — cash burn concern`);

  return { valid: errors.length === 0, errors, warnings, rowFlags };
}

function applyValidationStyles(ws, rowFieldMap, colToYrKey, rowFlags, XLSX) {
  const C_ERR  = 'FFDCDC'; // light red
  const C_WARN = 'FFFACD'; // light yellow
  for (const [rowStr, { section, field }] of Object.entries(rowFieldMap)) {
    const r = parseInt(rowStr);
    for (const [colStr, yr] of Object.entries(colToYrKey)) {
      const severity = rowFlags?.[yr]?.[section]?.[field];
      if (!severity) continue;
      const addr = XLSX.utils.encode_cell({ r, c: parseInt(colStr) });
      if (!ws[addr]) ws[addr] = { v: null, t: 'z' };
      ws[addr].s = { fill: { patternType: 'solid', fgColor: { rgb: severity === 'error' ? C_ERR : C_WARN } } };
    }
  }
}

function buildValidationSheet(vResult, XLSX) {
  const { errors = [], warnings = [] } = vResult;
  const rows = [['Data Validation Results'], [''], ['Severity', 'Issue']];
  if (!errors.length && !warnings.length) {
    rows.push(['OK', 'No validation issues found']);
  } else {
    for (const e of errors)   rows.push(['ERROR',   e]);
    for (const w of warnings) rows.push(['WARNING', w]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 12 }, { wch: 90 }];
  for (let i = 3; i < rows.length; i++) {
    const sev = rows[i][0];
    const rgb = sev === 'ERROR' ? 'FFDCDC' : sev === 'WARNING' ? 'FFFACD' : null;
    if (!rgb) continue;
    const fontColor = sev === 'ERROR' ? 'C00000' : '7B6600';
    for (const c of [0, 1]) {
      const addr = XLSX.utils.encode_cell({ r: i, c });
      if (!ws[addr]) ws[addr] = { v: rows[i][c] ?? '', t: 's' };
      ws[addr].s = { fill: { patternType: 'solid', fgColor: { rgb } }, ...(c === 0 ? { font: { bold: true, color: { rgb: fontColor } } } : {}) };
    }
  }
  return ws;
}

function wrapAggToYears(aggregated, aggregatedPrior) {
  const a = aggregated || {};
  const p = aggregatedPrior || {};
  const hasPrior = Object.values(p).some(v => v != null);
  function toEntry(agg) {
    return {
      profit_loss: {
        revenue: agg.revenue ?? null, gross_profit: agg.grossProfit ?? null,
        ebitda: agg.ebitda ?? null, ebit: agg.operatingProfit ?? null,
        depreciation: agg.depreciation ?? null, interest_expense: agg.interestExpense ?? null,
        pbt: agg.pbt ?? null, tax_expense: agg.tax ?? null, net_income: agg.netIncome ?? null,
      },
      balance_sheet: {
        total_assets: agg.totalAssets ?? null, current_assets: agg.currentAssets ?? null,
        non_current_assets: agg.nonCurrentAssets ?? null, fixed_assets: agg.fixedAssets ?? null,
        cash_and_equivalents: agg.cash ?? null, total_equity: agg.totalEquity ?? null,
        total_liabilities: agg.totalLiabilities ?? null, current_liabilities: agg.currentLiabilities ?? null,
        total_debt: agg.totalDebt ?? null,
      },
      cash_flow: {
        cfo: agg.operatingCashFlow ?? null, cfi: agg.investingCashFlow ?? null,
        cff: agg.financingCashFlow ?? null, net_change_in_cash: null,
      },
    };
  }
  const years = { cur: toEntry(a) };
  if (hasPrior) years.pri = toEntry(p);
  return { years, sortedYears: hasPrior ? ['pri', 'cur'] : ['cur'] };
}

function buildNullFieldReport(years, sortedYears) {
  if (!sortedYears.length) return [];
  const latestYr = sortedYears[sortedYears.length - 1];
  const data = years[latestYr];
  if (!data) return [];
  const missing = [];
  const checks = [
    ['profit_loss', ['revenue', 'net_income', 'ebitda', 'pbt']],
    ['balance_sheet', ['total_assets', 'total_equity', 'total_liabilities']],
    ['cash_flow', ['cfo', 'cfi', 'cff']],
  ];
  for (const [section, fields] of checks) {
    for (const field of fields) {
      if ((data[section] || {})[field] == null) {
        missing.push(`${latestYr} — ${section.replace('_', ' ')}: ${field.replace(/_/g, ' ')} not found`);
      }
    }
  }
  return missing;
}

function buildTrendSummary(years, sortedYears) {
  const trends = [];
  if (sortedYears.length < 2) return trends;
  const latestYr = sortedYears[sortedYears.length - 1];
  const prevYr = sortedYears[sortedYears.length - 2];
  const latest = years[latestYr] || {};
  const prev = years[prevYr] || {};
  const lpl = latest.profit_loss || {};
  const ppl = prev.profit_loss || {};
  if (lpl.revenue != null && ppl.revenue != null && ppl.revenue !== 0) {
    const g = ((lpl.revenue - ppl.revenue) / Math.abs(ppl.revenue)) * 100;
    trends.push(`Revenue ${g >= 0 ? 'grew' : 'declined'} ${Math.abs(g).toFixed(1)}% from ${prevYr} to ${latestYr}`);
  }
  if (lpl.net_income != null && ppl.net_income != null && ppl.net_income !== 0) {
    const g = ((lpl.net_income - ppl.net_income) / Math.abs(ppl.net_income)) * 100;
    if (lpl.net_income < 0) trends.push(`Net loss of ${Math.abs(lpl.net_income).toLocaleString()} in ${latestYr}`);
    else trends.push(`Net income ${g >= 0 ? 'improved' : 'declined'} ${Math.abs(g).toFixed(1)}% year-over-year`);
  }
  const lbs = latest.balance_sheet || {};
  if (lbs.total_debt != null && lbs.total_equity != null && lbs.total_equity !== 0) {
    const de = lbs.total_debt / lbs.total_equity;
    if (de > 2) trends.push(`High leverage: D/E ratio ${de.toFixed(2)}x in ${latestYr}`);
    else if (de < 0.5) trends.push(`Conservative leverage: D/E ratio ${de.toFixed(2)}x in ${latestYr}`);
  }
  return trends;
}

async function generateScannedExcel(structuredData, companyInfo, onProgress) {
  onProgress?.("📊 Building Excel workbook...");
  const XLSX = await loadSheetJS();

  const { years = {}, currency = 'INR', unit = 'Lakhs', pageMetadata = [], totalPages = 0 } = structuredData;
  const sortedYears = Object.keys(years).sort();
  const vResult = validateFinancialData(years, sortedYears);
  const nullReport = buildNullFieldReport(years, sortedYears);
  const trends = buildTrendSummary(years, sortedYears);
  const companyName = structuredData.company_name || companyInfo.name || 'Company';
  const extractionMethod = structuredData.extractionMethod || 'tesseract';
  const methodLabel = extractionMethod === 'tesseract' ? 'Tesseract OCR' : 'Scanned PDF OCR';

  const wb = XLSX.utils.book_new();

  // col index → year key (col 0 = label, col 1+ = sortedYears)
  const colToYr = {};
  sortedYears.forEach((yr, i) => { colToYr[i + 1] = yr; });

  function makeHeader(title) {
    return [
      [`${companyName} — ${title}`],
      [`Currency: ${currency} | Unit: ${unit} | Source: Scanned PDF (${methodLabel})`],
      [''],
    ];
  }

  function makeRow(label, fieldPath) {
    const parts = fieldPath.split('.');
    const row = [label];
    for (const yr of sortedYears) {
      let val = years[yr] || {};
      for (const p of parts) val = val?.[p] ?? null;
      row.push(val !== null && val !== undefined ? val : null);
    }
    return row;
  }

  // Sheet 1: P&L Summary
  // Row indices: 0=title,1=subtitle,2=blank,3=colHdr,4=REVENUE,5=revenue,6=other_income,
  //   7=total_income,8=blank,9=EXPENSES,10=cogs,11=employee,12=interest_expense,13=depreciation,
  //   14=other_exp,15=total_exp,16=blank,17=PROFITABILITY,18=ebitda,19=pbt,20=tax,21=net_income
  const plData = [
    ...makeHeader('Profit & Loss Summary'),
    ['', ...sortedYears],
    ['REVENUE'],
    makeRow('Total Revenue', 'profit_loss.revenue'),
    makeRow('Other Income', 'profit_loss.other_income'),
    makeRow('Total Income', 'profit_loss.total_income'),
    [''],
    ['EXPENSES'],
    makeRow('Cost of Goods Sold', 'profit_loss.cost_of_goods'),
    makeRow('Employee Costs', 'profit_loss.employee_costs'),
    makeRow('Finance Costs', 'profit_loss.interest_expense'),
    makeRow('Depreciation', 'profit_loss.depreciation'),
    makeRow('Other Expenses', 'profit_loss.other_expenses'),
    makeRow('Total Expenses', 'profit_loss.total_expenses'),
    [''],
    ['PROFITABILITY'],
    makeRow('EBITDA', 'profit_loss.ebitda'),
    makeRow('Profit Before Tax (PBT)', 'profit_loss.pbt'),
    makeRow('Tax', 'profit_loss.tax_expense'),
    makeRow('Net Income / PAT', 'profit_loss.net_income'),
  ];
  const wsPL = XLSX.utils.aoa_to_sheet(plData);
  applyValidationStyles(wsPL, {
    5:  { section: 'profit_loss', field: 'revenue' },
    6:  { section: 'profit_loss', field: 'other_income' },
    12: { section: 'profit_loss', field: 'interest_expense' },
    13: { section: 'profit_loss', field: 'depreciation' },
    18: { section: 'profit_loss', field: 'ebitda' },
    19: { section: 'profit_loss', field: 'pbt' },
    20: { section: 'profit_loss', field: 'tax_expense' },
    21: { section: 'profit_loss', field: 'net_income' },
  }, colToYr, vResult.rowFlags, XLSX);
  XLSX.utils.book_append_sheet(wb, wsPL, 'P&L Summary');

  // Sheet 2: Balance Sheet
  // Row indices: 0-3=header+colHdr,4=EQUITY&LIAB,5=share_cap,6=reserves,7=total_equity,
  //   8=lt_debt,9=st_debt,10=total_debt,11=trade_payables,12=other_cur_liab,13=total_liabilities,
  //   14=blank,15=ASSETS,16=fixed_assets,17=intangibles,18=investments,19=receivables,
  //   20=inventory,21=cash,22=current_assets,23=total_assets
  const bsData = [
    ...makeHeader('Balance Sheet'),
    ['', ...sortedYears],
    ['EQUITY & LIABILITIES'],
    makeRow('Share Capital', 'balance_sheet.share_capital'),
    makeRow('Reserves & Surplus', 'balance_sheet.reserves'),
    makeRow('Total Equity', 'balance_sheet.total_equity'),
    makeRow('Long-term Debt', 'balance_sheet.long_term_debt'),
    makeRow('Short-term Debt', 'balance_sheet.short_term_debt'),
    makeRow('Total Debt', 'balance_sheet.total_debt'),
    makeRow('Trade Payables', 'balance_sheet.trade_payables'),
    makeRow('Other Current Liabilities', 'balance_sheet.other_current_liabilities'),
    makeRow('Total Liabilities', 'balance_sheet.total_liabilities'),
    [''],
    ['ASSETS'],
    makeRow('Fixed Assets / PPE', 'balance_sheet.fixed_assets'),
    makeRow('Intangibles / Goodwill', 'balance_sheet.intangibles'),
    makeRow('Investments', 'balance_sheet.investments'),
    makeRow('Trade Receivables', 'balance_sheet.trade_receivables'),
    makeRow('Inventory', 'balance_sheet.inventory'),
    makeRow('Cash & Equivalents', 'balance_sheet.cash_and_equivalents'),
    makeRow('Current Assets', 'balance_sheet.current_assets'),
    makeRow('Total Assets', 'balance_sheet.total_assets'),
  ];
  const wsBS = XLSX.utils.aoa_to_sheet(bsData);
  applyValidationStyles(wsBS, {
    7:  { section: 'balance_sheet', field: 'total_equity' },
    10: { section: 'balance_sheet', field: 'total_debt' },
    13: { section: 'balance_sheet', field: 'total_liabilities' },
    16: { section: 'balance_sheet', field: 'fixed_assets' },
    21: { section: 'balance_sheet', field: 'cash_and_equivalents' },
    22: { section: 'balance_sheet', field: 'current_assets' },
    23: { section: 'balance_sheet', field: 'total_assets' },
  }, colToYr, vResult.rowFlags, XLSX);
  XLSX.utils.book_append_sheet(wb, wsBS, 'Balance Sheet');

  // Sheet 3: Cash Flow
  // Row indices: 0-3=header+colHdr,4=cfo,5=cfi,6=cff,7=net_change,8=closing_cash
  const cfData = [
    ...makeHeader('Cash Flow Statement'),
    ['', ...sortedYears],
    makeRow('Cash from Operations (CFO)', 'cash_flow.cfo'),
    makeRow('Cash from Investing (CFI)', 'cash_flow.cfi'),
    makeRow('Cash from Financing (CFF)', 'cash_flow.cff'),
    makeRow('Net Change in Cash', 'cash_flow.net_change_in_cash'),
    makeRow('Closing Cash Balance', 'cash_flow.closing_cash'),
  ];
  const wsCF = XLSX.utils.aoa_to_sheet(cfData);
  applyValidationStyles(wsCF, {
    4: { section: 'cash_flow', field: 'cfo' },
    5: { section: 'cash_flow', field: 'cfi' },
    6: { section: 'cash_flow', field: 'cff' },
    7: { section: 'cash_flow', field: 'net_change_in_cash' },
  }, colToYr, vResult.rowFlags, XLSX);
  XLSX.utils.book_append_sheet(wb, wsCF, 'Cash Flow');

  // Sheet 4: Key Ratios (computed inline)
  const ratioData = [
    ...makeHeader('Key Ratios'),
    ['', ...sortedYears],
    ['PROFITABILITY'],
    ['Gross Margin (%)', ...sortedYears.map(yr => {
      const pl = (years[yr] || {}).profit_loss || {};
      if (pl.revenue && pl.cost_of_goods != null) return +((( pl.revenue - pl.cost_of_goods) / pl.revenue) * 100).toFixed(2);
      return null;
    })],
    ['Net Margin (%)', ...sortedYears.map(yr => {
      const pl = (years[yr] || {}).profit_loss || {};
      if (pl.revenue && pl.net_income != null) return +((pl.net_income / pl.revenue) * 100).toFixed(2);
      return null;
    })],
    ['EBITDA Margin (%)', ...sortedYears.map(yr => {
      const pl = (years[yr] || {}).profit_loss || {};
      if (pl.revenue && pl.ebitda != null) return +((pl.ebitda / pl.revenue) * 100).toFixed(2);
      return null;
    })],
    [''],
    ['LEVERAGE'],
    ['Debt-to-Equity (x)', ...sortedYears.map(yr => {
      const bs = (years[yr] || {}).balance_sheet || {};
      if (bs.total_debt != null && bs.total_equity) return +(bs.total_debt / bs.total_equity).toFixed(2);
      return null;
    })],
    ['Interest Coverage (x)', ...sortedYears.map(yr => {
      const pl = (years[yr] || {}).profit_loss || {};
      if (pl.ebitda != null && pl.finance_costs) return +(pl.ebitda / pl.finance_costs).toFixed(2);
      return null;
    })],
    [''],
    ['RETURNS'],
    ['ROE (%)', ...sortedYears.map(yr => {
      const pl = (years[yr] || {}).profit_loss || {};
      const bs = (years[yr] || {}).balance_sheet || {};
      if (pl.net_income != null && bs.total_equity) return +((pl.net_income / bs.total_equity) * 100).toFixed(2);
      return null;
    })],
    ['ROA (%)', ...sortedYears.map(yr => {
      const pl = (years[yr] || {}).profit_loss || {};
      const bs = (years[yr] || {}).balance_sheet || {};
      if (pl.net_income != null && bs.total_assets) return +((pl.net_income / bs.total_assets) * 100).toFixed(2);
      return null;
    })],
    [''],
    ['PER SHARE'],
    makeRow('EPS', 'ratios.eps'),
    makeRow('Book Value per Share', 'ratios.book_value_per_share'),
    makeRow('Dividend per Share', 'ratios.dividend_per_share'),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ratioData), 'Key Ratios');

  // Sheet 5: Validation
  XLSX.utils.book_append_sheet(wb, buildValidationSheet(vResult, XLSX), 'Validation');

  // Sheet 6: Analysis
  const analysisData = [
    ...makeHeader('Analysis & Insights'),
    ['TREND SUMMARY'],
    ...(trends.length ? trends.map(t => [t]) : [['Insufficient multi-year data for trend analysis']]),
    [''],
    ['DATA QUALITY — MISSING FIELDS (latest year)'],
    ...(nullReport.length ? nullReport.map(n => [n]) : [['All key fields populated']]),
    [''],
    ['EXTRACTION DETAILS'],
    [`Pages processed: ${pageMetadata.length} of ${totalPages}`],
    [`Financial data years found: ${sortedYears.join(', ') || 'None detected'}`],
    [`Extraction method: ${methodLabel}`],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(analysisData), 'Analysis');

  // Sheet 7: Metadata
  const metaData = [
    ['Page', 'Method', 'OCR Confidence', 'Notes'],
    ...pageMetadata.map(m => [
      m.page,
      m.method,
      m.confidence != null ? `${m.confidence.toFixed(0)}%` : '',
      m.reason || '',
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(metaData), 'Metadata');

  onProgress?.(`✅ Excel ready — 6 sheets, ${sortedYears.length} year(s) of data`);

  const arrayBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([arrayBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const safeName = (companyInfo.name || 'Company').replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_') || 'Company';
  const fileName = `${safeName}_ScannedFinancials_${new Date().toISOString().slice(0, 10)}.xlsx`;
  return { excelBlob: blob, fileName };
}

function safeParseFinancialJSON(raw) {
  if (!raw) throw new Error('Empty response from Claude')
  let cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON object found in response')
  const jsonStr = cleaned.slice(start, end + 1)
  try {
    return JSON.parse(jsonStr)
  } catch(e) {
    const fixed = jsonStr
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3')
    return JSON.parse(fixed)
  }
}

function deriveMetrics(a) {
  const pl = a.profit_loss || {}
  const bs = a.balance_sheet || {}
  const cf = a.cash_flow || {}

  if ((pl.gross_profit?.current == null) && pl.revenue?.current != null && pl.cogs?.current != null) {
    pl.gross_profit = {
      current: (pl.revenue.current || 0) - (pl.cogs.current || 0),
      prior: (pl.revenue.prior || 0) - (pl.cogs.prior || 0)
    }
  }

  if ((pl.ebitda?.current == null) && pl.profit_before_tax?.current != null) {
    const pbt_c = pl.profit_before_tax.current || 0
    const pbt_p = pl.profit_before_tax.prior || 0
    const dep_c = pl.depreciation?.current || 0
    const dep_p = pl.depreciation?.prior || 0
    const fin_c = pl.finance_costs?.current || 0
    const fin_p = pl.finance_costs?.prior || 0
    pl.ebitda = { current: pbt_c + dep_c + fin_c, prior: pbt_p + dep_p + fin_p }
  }

  if ((pl.ebit?.current == null) && pl.ebitda?.current != null) {
    const dep_c = pl.depreciation?.current || 0
    const dep_p = pl.depreciation?.prior || 0
    pl.ebit = { current: (pl.ebitda.current || 0) - dep_c, prior: (pl.ebitda.prior || 0) - dep_p }
  }

  if (!bs.total_debt && (bs.long_term_borrowings || bs.short_term_borrowings)) {
    bs.total_debt = {
      current: (bs.long_term_borrowings?.current || 0) + (bs.short_term_borrowings?.current || 0),
      prior: (bs.long_term_borrowings?.prior || 0) + (bs.short_term_borrowings?.prior || 0)
    }
  }

  if (!bs.working_capital && bs.current_assets && bs.current_liabilities) {
    bs.working_capital = {
      current: (bs.current_assets.current || 0) - (bs.current_liabilities.current || 0),
      prior: (bs.current_assets.prior || 0) - (bs.current_liabilities.prior || 0)
    }
  }

  if (!cf.net_change_in_cash && cf.closing_cash && cf.opening_cash) {
    cf.net_change_in_cash = {
      current: (cf.closing_cash.current || 0) - (cf.opening_cash.current || 0),
      prior: (cf.closing_cash.prior || 0) - (cf.opening_cash.prior || 0)
    }
  }

  return a
}

function checkBalanceSheet(bs, label) {
  const assets = bs.total_assets?.current || 0
  const equity = bs.total_equity?.current || 0
  const debt = bs.total_debt?.current || 0
  const currentLiab = bs.current_liabilities?.current || 0
  const liabilities = equity + debt + currentLiab
  const delta = Math.abs(assets - liabilities)
  if (assets > 0 && delta > assets * 0.05) {
    console.warn(`[FinSight] ${label} balance sheet mismatch: assets=${assets}, liabilities=${liabilities}, delta=${delta}`)
  }
}

async function processPrivateCompanyDoc(file, options, onProgress, onDebug = () => {}) {
  try {
    onProgress('reading')
    onDebug('FILE RECEIVED: ' + file.name)

    const arrayBuffer = await file.arrayBuffer()
    const pdfjsLib = await loadPdfJs()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    onDebug('PDF: ' + pdf.numPages + ' pages')

    // ── Layer 1: per-page text extraction + quality measurement ─────────────
    const pageTexts = []
    for (let i = 1; i <= pdf.numPages; i++) {
      try {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        pageTexts.push(content.items.map(item => item.str).join(' '))
      } catch(e) { pageTexts.push('') }
    }

    const fullText = pageTexts.join('\n')
    const scannedPageCount = pageTexts.filter(t => t.trim().length < 50).length
    const scannedRatio = scannedPageCount / pdf.numPages
    const cleanedText = fullText.replace(/\s+/g, ' ').trim()
    const isTextPdf = cleanedText.length > 500 && /\d{3,}/.test(cleanedText) && scannedRatio < 0.3

    console.log('[FinSight] Text extraction complete:', {
      totalPages: pdf.numPages,
      scannedPageCount,
      scannedRatio,
      textLength: cleanedText.length,
      hasNumbers: /\d{3,}/.test(cleanedText),
      isTextPdf
    })
    console.log('[FinSight] Pipeline path:', isTextPdf ? 'TEXT' : 'VISION')

    onDebug('TEXT: ' + fullText.length + ' chars, scannedRatio=' + scannedRatio.toFixed(2) + ', isTextPdf=' + isTextPdf)

    let rawText
    if (isTextPdf) {
      // ── Text path ──────────────────────────────────────────────────────────
      let textToSend = fullText
      if (fullText.length > 60000) {
        const fsIndex = fullText.search(/Balance Sheet|Statement of Profit|Profit and Loss/i)
        if (fsIndex > 0) {
          const s = Math.max(0, fsIndex - 3000)
          textToSend = fullText.substring(s, s + 60000)
          onDebug('TEXT FOCUSED: financial section found')
        } else {
          textToSend = fullText.substring(0, 60000)
          onDebug('TEXT TRIMMED: first 60000 chars')
        }
      }

      onProgress('extracting')
      onDebug('CALLING CLAUDE API (text)...')

    const systemPrompt = `You are a senior chartered accountant and financial analyst.
Extract financial data from Indian company filings with perfect accuracy.
Return ONLY valid JSON. No markdown, no explanation, no text outside the JSON object.`

    const userPrompt = `Extract ALL financial data from this document and return as JSON with this exact structure:

{
  "company_name": "",
  "financial_year": "",
  "currency": "INR",
  "unit": "Lakhs",
  "profit_loss": {
    "revenue": { "current": 0, "prior": 0 },
    "other_income": { "current": 0, "prior": 0 },
    "total_income": { "current": 0, "prior": 0 },
    "cogs": { "current": 0, "prior": 0 },
    "gross_profit": { "current": 0, "prior": 0 },
    "employee_costs": { "current": 0, "prior": 0 },
    "other_expenses": { "current": 0, "prior": 0 },
    "ebitda": { "current": 0, "prior": 0 },
    "depreciation": { "current": 0, "prior": 0 },
    "ebit": { "current": 0, "prior": 0 },
    "finance_costs": { "current": 0, "prior": 0 },
    "profit_before_tax": { "current": 0, "prior": 0 },
    "tax_expense": { "current": 0, "prior": 0 },
    "profit_after_tax": { "current": 0, "prior": 0 }
  },
  "balance_sheet": {
    "total_assets": { "current": 0, "prior": 0 },
    "fixed_assets": { "current": 0, "prior": 0 },
    "current_assets": { "current": 0, "prior": 0 },
    "cash_and_equivalents": { "current": 0, "prior": 0 },
    "trade_receivables": { "current": 0, "prior": 0 },
    "inventory": { "current": 0, "prior": 0 },
    "non_current_assets": { "current": 0, "prior": 0 },
    "total_equity": { "current": 0, "prior": 0 },
    "share_capital": { "current": 0, "prior": 0 },
    "reserves_and_surplus": { "current": 0, "prior": 0 },
    "long_term_borrowings": { "current": 0, "prior": 0 },
    "short_term_borrowings": { "current": 0, "prior": 0 },
    "total_debt": { "current": 0, "prior": 0 },
    "current_liabilities": { "current": 0, "prior": 0 },
    "trade_payables": { "current": 0, "prior": 0 }
  },
  "cash_flow": {
    "operating_cash_flow": { "current": 0, "prior": 0 },
    "investing_cash_flow": { "current": 0, "prior": 0 },
    "financing_cash_flow": { "current": 0, "prior": 0 },
    "net_change_in_cash": { "current": 0, "prior": 0 },
    "opening_cash": { "current": 0, "prior": 0 },
    "closing_cash": { "current": 0, "prior": 0 }
  }
}

RULES:
1. Use null (not 0) for any value genuinely not present in the document
2. If EBITDA is not stated, calculate it: PBT + Depreciation + Finance Costs
3. If Gross Profit is not stated, calculate it: Revenue - COGS
4. All values must be numbers, never strings
5. Do not invent or estimate values — only extract what is explicitly in the document
6. prior = previous year comparative figures
7. current = current reporting year figures
8. If cash flow statement is absent, set all cash_flow values to null

DOCUMENT TEXT:
${textToSend}`

      rawText = await callClaude({ system: systemPrompt, userMsg: userPrompt, maxTokens: 8192 })

    } else {
      // ── Layer 2: Vision path (scanned / hybrid PDF) ──────────────────────
      onProgress('vision')
      onDebug('CALLING CLAUDE API (vision)...')

      const MAX_PAGES = 8
      const scale = 1.5
      const pageImages = []

      for (let i = 1; i <= Math.min(pdf.numPages, MAX_PAGES + 1); i++) {
        if (pageImages.length >= MAX_PAGES) break
        try {
          const page = await pdf.getPage(i)
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          const ctx = canvas.getContext('2d')
          await page.render({ canvasContext: ctx, viewport }).promise

          if (i === 1) {
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data
            let sum = 0
            for (let px = 0; px < imgData.length; px += 4) sum += imgData[px]
            const mean = sum / (imgData.length / 4)
            let variance = 0
            for (let px = 0; px < imgData.length; px += 4) variance += Math.pow(imgData[px] - mean, 2)
            variance /= (imgData.length / 4)
            if (variance < 200) { onDebug('SKIP page 1: low variance (cover)'); continue }
          }

          const b64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
          pageImages.push(b64)
        } catch(e) { onDebug('Page ' + i + ' render error: ' + e.message) }
      }

      onDebug('VISION: ' + pageImages.length + ' pages rendered')

      const visionContent = [
        ...pageImages.map(b64 => ({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: b64 }
        })),
        {
          type: 'text',
          text: `You are a senior chartered accountant. Extract ALL financial data from these document images with 100% accuracy.
Return ONLY valid JSON — no markdown, no explanation outside JSON:
{
  "company_name": "",
  "financial_year": "",
  "currency": "INR",
  "unit": "Lakhs",
  "profit_loss": {
    "revenue": { "current": null, "prior": null },
    "other_income": { "current": null, "prior": null },
    "total_income": { "current": null, "prior": null },
    "cogs": { "current": null, "prior": null },
    "gross_profit": { "current": null, "prior": null },
    "employee_costs": { "current": null, "prior": null },
    "other_expenses": { "current": null, "prior": null },
    "ebitda": { "current": null, "prior": null },
    "depreciation": { "current": null, "prior": null },
    "ebit": { "current": null, "prior": null },
    "finance_costs": { "current": null, "prior": null },
    "profit_before_tax": { "current": null, "prior": null },
    "tax_expense": { "current": null, "prior": null },
    "profit_after_tax": { "current": null, "prior": null }
  },
  "balance_sheet": {
    "total_assets": { "current": null, "prior": null },
    "fixed_assets": { "current": null, "prior": null },
    "current_assets": { "current": null, "prior": null },
    "cash_and_equivalents": { "current": null, "prior": null },
    "trade_receivables": { "current": null, "prior": null },
    "inventory": { "current": null, "prior": null },
    "non_current_assets": { "current": null, "prior": null },
    "total_equity": { "current": null, "prior": null },
    "share_capital": { "current": null, "prior": null },
    "reserves_and_surplus": { "current": null, "prior": null },
    "long_term_borrowings": { "current": null, "prior": null },
    "short_term_borrowings": { "current": null, "prior": null },
    "total_debt": { "current": null, "prior": null },
    "current_liabilities": { "current": null, "prior": null },
    "trade_payables": { "current": null, "prior": null }
  },
  "cash_flow": {
    "operating_cash_flow": { "current": null, "prior": null },
    "investing_cash_flow": { "current": null, "prior": null },
    "financing_cash_flow": { "current": null, "prior": null },
    "net_change_in_cash": { "current": null, "prior": null },
    "opening_cash": { "current": null, "prior": null },
    "closing_cash": { "current": null, "prior": null }
  }
}
Rules:
1. null for any value not found — never guess or hallucinate
2. All values must be numbers, never strings
3. current = this reporting year, prior = previous year comparative
4. If EBITDA missing: PBT + Depreciation + Finance Costs
5. If Gross Profit missing: Revenue - COGS
6. Detect unit automatically — Lakhs, Crores, Millions, Thousands
7. If document is in Crores, convert all values to Lakhs (×100)`
        }
      ]

      rawText = await callClaude({ userMsg: visionContent, maxTokens: 4000 })
    }

    onProgress('analysing')
    onDebug('CLAUDE RESPONSE: ' + rawText.substring(0, 100))
    console.log('[FinSight] Claude raw response length:', rawText?.length)
    console.log('[FinSight] Claude raw response preview:', rawText?.substring(0, 500))

    const claudeResult = safeParseFinancialJSON(rawText)
    onDebug('EXTRACTED: company=' + claudeResult.company_name + ' revenue=' + claudeResult.profit_loss?.revenue?.current)
    console.log('[FinSight] Parsed JSON:', JSON.stringify(claudeResult, null, 2).substring(0, 1000))

    deriveMetrics(claudeResult)
    console.log('After deriveMetrics:', {
      gross_profit: claudeResult?.profit_loss?.gross_profit,
      ebitda: claudeResult?.profit_loss?.ebitda,
      ebit: claudeResult?.profit_loss?.ebit
    })
    checkBalanceSheet(claudeResult.balance_sheet || {}, 'Current Year')

    const pl = claudeResult.profit_loss || {}
    const bs = claudeResult.balance_sheet || {}
    const cf = claudeResult.cash_flow || {}

    const aggregated = {
      revenue: pl.revenue?.current ?? pl.total_income?.current ?? null,
      otherIncome: pl.other_income?.current ?? null,
      totalIncome: pl.total_income?.current ?? null,
      grossProfit: pl.gross_profit?.current ?? null,
      ebitda: pl.ebitda?.current ?? null,
      operatingProfit: pl.ebit?.current ?? null,
      pbt: pl.profit_before_tax?.current ?? null,
      tax: pl.tax_expense?.current ?? null,
      netIncome: pl.profit_after_tax?.current ?? null,
      interestExpense: pl.finance_costs?.current ?? null,
      depreciation: pl.depreciation?.current ?? null,
      cogs: pl.cogs?.current ?? null,
      employeeCosts: pl.employee_costs?.current ?? null,
      otherExpenses: pl.other_expenses?.current ?? null,
      totalExpenses: null,
      eps: null,
      totalAssets: bs.total_assets?.current ?? null,
      currentAssets: bs.current_assets?.current ?? null,
      nonCurrentAssets: bs.non_current_assets?.current ?? null,
      cash: bs.cash_and_equivalents?.current ?? null,
      inventory: bs.inventory?.current ?? null,
      receivables: bs.trade_receivables?.current ?? null,
      fixedAssets: bs.fixed_assets?.current ?? null,
      totalLiabilities: null,
      currentLiabilities: bs.current_liabilities?.current ?? null,
      nonCurrentLiabilities: null,
      totalEquity: bs.total_equity?.current ?? null,
      longTermDebt: bs.long_term_borrowings?.current ?? null,
      shortTermDebt: bs.short_term_borrowings?.current ?? null,
      tradePayables: bs.trade_payables?.current ?? null,
      shareCapital: bs.share_capital?.current ?? null,
      reserves: bs.reserves_and_surplus?.current ?? null,
      operatingCashFlow: cf.operating_cash_flow?.current ?? null,
      investingCashFlow: cf.investing_cash_flow?.current ?? null,
      financingCashFlow: cf.financing_cash_flow?.current ?? null,
    }

    const aggregatedPrior = {
      revenue: pl.revenue?.prior ?? pl.total_income?.prior ?? null,
      otherIncome: pl.other_income?.prior ?? null,
      totalIncome: pl.total_income?.prior ?? null,
      grossProfit: pl.gross_profit?.prior ?? null,
      ebitda: pl.ebitda?.prior ?? null,
      operatingProfit: pl.ebit?.prior ?? null,
      pbt: pl.profit_before_tax?.prior ?? null,
      tax: pl.tax_expense?.prior ?? null,
      netIncome: pl.profit_after_tax?.prior ?? null,
      interestExpense: pl.finance_costs?.prior ?? null,
      depreciation: pl.depreciation?.prior ?? null,
      cogs: pl.cogs?.prior ?? null,
      employeeCosts: pl.employee_costs?.prior ?? null,
      otherExpenses: pl.other_expenses?.prior ?? null,
      totalExpenses: null,
      eps: null,
      totalAssets: bs.total_assets?.prior ?? null,
      currentAssets: bs.current_assets?.prior ?? null,
      nonCurrentAssets: bs.non_current_assets?.prior ?? null,
      cash: bs.cash_and_equivalents?.prior ?? null,
      inventory: bs.inventory?.prior ?? null,
      receivables: bs.trade_receivables?.prior ?? null,
      fixedAssets: bs.fixed_assets?.prior ?? null,
      totalLiabilities: null,
      currentLiabilities: bs.current_liabilities?.prior ?? null,
      nonCurrentLiabilities: null,
      totalEquity: bs.total_equity?.prior ?? null,
      longTermDebt: bs.long_term_borrowings?.prior ?? null,
      shortTermDebt: bs.short_term_borrowings?.prior ?? null,
      tradePayables: bs.trade_payables?.prior ?? null,
      shareCapital: bs.share_capital?.prior ?? null,
      reserves: bs.reserves_and_surplus?.prior ?? null,
      operatingCashFlow: cf.operating_cash_flow?.prior ?? null,
      investingCashFlow: cf.investing_cash_flow?.prior ?? null,
      financingCashFlow: cf.financing_cash_flow?.prior ?? null,
    }

    const companyInfo = {
      name: claudeResult.company_name || file.name.replace('.pdf', ''),
      cin: null,
      sector: null,
      auditor: null,
      directors: [],
      financialYear: claudeResult.financial_year || 'FY2025',
      currency: claudeResult.currency || 'INR',
      unit: claudeResult.unit || 'Lakhs',
      reportingType: 'Standalone'
    }

    console.log('[FinSight] aggregated.profit_loss:', aggregated?.profit_loss)

    const validCount = Object.values(aggregated).filter(v => v !== null).length
    onDebug('VALID FIELDS: ' + validCount)

    if (validCount < 5) {
      throw new Error('Insufficient data extracted. Please upload XBRL version from mca.gov.in')
    }

    onProgress('generating')

    const swot = await generateSWOTAndInterpretation(companyInfo, aggregated, null, null, aggregatedPrior)

    let excelResult = null
    let wordResult = null
    console.log('[FinSight] Starting Excel generation')
    try {
      excelResult = await generateFinancialExcel(companyInfo, aggregated, aggregatedPrior, null, swot, {}, {})
    } catch(e) {
      console.error('Excel generation failed:', e)
    }
    console.log('[FinSight] Excel result:', { hasBlob: !!excelResult?.excelBlob, size: excelResult?.excelBlob?.size })
    console.log('[FinSight] Starting Word generation')
    try {
      wordResult = await generateOrganizedWordDoc([], companyInfo, null, swot, [], file.name, { aggregated, aggregatedPrior })
    } catch(e) {
      console.error('Word generation failed:', e)
    }
    console.log('[FinSight] Word result:', { hasBlob: !!wordResult?.blob, size: wordResult?.blob?.size })

    onProgress('complete')

    return {
      excelBlob: excelResult?.excelBlob || null,
      excelFileName: excelResult?.fileName || 'FinSight_' + (companyInfo.name || 'Report').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) + '_Financials.xlsx',
      docxBlob: wordResult?.docxBlob || null,
      docxFileName: wordResult?.fileName || 'FinSight_' + (companyInfo.name || 'Report').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) + '_Report.docx',
      pdfBlob: null,
      pdfFileName: null,
      briefWordBlob: null,
      briefWordFileName: null,
      briefWordError: null,
      noFinancialData: false,
      apiUnavailable: false,
      extractionMethod: 'text',
      extractionWarnings: [],
      sectionCount: 0,
      ratioCount: 0,
      hasSWOT: !!swot,
      hasCharts: false,
      pdfFileSizeKB: 0,
      failedChunks: 0,
      companyInfo,
      aggregated,
      aggregatedPrior,
      swot
    }

  } catch(err) {
    console.error('[FinSight] Pipeline crashed:', err.message, err.stack)
    onDebug('ERROR: ' + err.message)
    throw err
  }
}


async function generateFinancialExcel(companyInfo, aggregated, aggregatedPrior, ratios, swot, documentMetadata = {}, visionStructuredData = {}) {
  const XLSX = await loadSheetJS();

  const a  = aggregated     || {};
  const p  = aggregatedPrior || {};
  const hasPrior = Object.values(p).some(v => v != null);

  const unit     = companyInfo.rounding || documentMetadata.unit || 'Lakhs';
  const currency = companyInfo.currency || documentMetadata.currency || 'INR';
  const name     = companyInfo.name     || 'Company';
  const period   = companyInfo.period   || '';
  const cin      = documentMetadata.cin  || '';

  const today = new Date();
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const todayStr = `${String(today.getDate()).padStart(2,'0')} ${MON[today.getMonth()]} ${today.getFullYear()}`;

  const fyLabels = (() => {
    const m = (period).match(/\b(20\d{2})\b/g);
    if (m?.length >= 2) return {
      cur: `FY ${m[0].slice(-2)}-${m[1].slice(-2)}`,
      pri: `FY ${(parseInt(m[0]) - 1).toString().slice(-2)}-${m[0].slice(-2)}`,
    };
    return { cur: 'Current Year', pri: 'Prior Year' };
  })();

  const wb = XLSX.utils.book_new();

  // ── Style helpers (xlsx-js-style) ─────────────────────────────────────────
  const HDR_STYLE = {
    fill: { patternType: 'solid', fgColor: { rgb: '1B4332' } },
    font: { color: { rgb: 'FFFFFF' }, bold: true, sz: 10, name: 'Calibri' },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  };
  const ALT_STYLE = {
    fill: { patternType: 'solid', fgColor: { rgb: 'F0F4F0' } },
    alignment: { vertical: 'center', wrapText: false },
  };
  const TOTAL_STYLE = {
    font: { bold: true, name: 'Calibri', sz: 10 },
    border: {
      top: { style: 'thin', color: { rgb: '1B4332' } },
      bottom: { style: 'medium', color: { rgb: '1B4332' } },
    },
    alignment: { vertical: 'center' },
  };
  const NEG_STYLE = { font: { color: { rgb: 'C0392B' }, name: 'Calibri', sz: 10 } };
  const TITLE_STYLE = { font: { bold: true, sz: 13, name: 'Calibri', color: { rgb: '1B4332' } } };
  const SUB_HDR_STYLE = { font: { italic: true, sz: 9, name: 'Calibri', color: { rgb: '555555' } } };

  // Apply consistent styles to a worksheet
  function styleSheet(ws, dataRows, headerRows, totalRowLabels) {
    headerRows = headerRows || 1;
    totalRowLabels = totalRowLabels || [];
    const ref = ws['!ref'];
    if (!ref) return;
    const range = XLSX.utils.decode_range(ref);
    for (let r = range.s.r; r <= range.e.r; r++) {
      const isHeader = r < headerRows;
      const rowData = dataRows[r] || [];
      const rowLabel = String(rowData[0] || '').toLowerCase().trim();
      const isTotal = totalRowLabels.some(t => rowLabel.includes(t.toLowerCase()));
      const isAlt = !isHeader && !isTotal && r % 2 === 0;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (!ws[addr]) continue;
        const v = ws[addr].v;
        const isNeg = typeof v === 'number' && v < 0;
        if (isHeader) {
          ws[addr].s = { ...HDR_STYLE };
        } else if (isTotal) {
          ws[addr].s = {
            ...TOTAL_STYLE,
            ...(isNeg ? { font: { ...TOTAL_STYLE.font, color: { rgb: 'C0392B' } } } : {}),
          };
        } else {
          ws[addr].s = {
            ...(isAlt ? ALT_STYLE : { alignment: { vertical: 'center' } }),
            ...(isNeg ? NEG_STYLE : {}),
          };
        }
      }
    }
    // Title row (row 0) special styling
    const titleAddr = XLSX.utils.encode_cell({ r: 0, c: 0 });
    if (ws[titleAddr]) ws[titleAddr].s = TITLE_STYLE;
    const subHdrAddr = XLSX.utils.encode_cell({ r: 1, c: 0 });
    if (ws[subHdrAddr]) ws[subHdrAddr].s = SUB_HDR_STYLE;
  }

  // ── Shared row builders ───────────────────────────────────────────────────
  // Safe number — keep null as null so cells stay blank
  const n  = (v) => (v != null && !isNaN(v) && isFinite(v)) ? v : null;
  const r2 = (v) => v != null ? Math.round(v * 100) / 100 : v;
  // YoY % as formatted string
  const yoyStr = (c, pr) => {
    if (c == null || pr == null || pr === 0) return '—';
    const f = (c - pr) / Math.abs(pr);
    return `${f >= 0 ? '+' : ''}${(f * 100).toFixed(1)}%`;
  };
  // CAGR helper for P&L (1-year growth displayed as % string)
  const cagr = (cur, pri) => (cur != null && pri != null && pri > 0)
    ? `${((cur / pri - 1) * 100).toFixed(1)}%`
    : '—';

  const subHdr = `Values in ${unit} of ${currency}  |  Period: ${period}  |  Generated: ${todayStr}`;

  // Historical N/A placeholder (em-dash looks cleaner than "N/A")
  const NA = '—';

  // A data row — with 4 historical N/A columns prepended + optional prior + current + YoY + CAGR
  // For P&L (withCagr=true): Particulars | FY20 | FY21 | FY22 | FY23 | [prior] | cur | YoY% | CAGR
  // For BS/CF (withCagr=false): Particulars | FY20 | FY21 | FY22 | FY23 | [prior] | cur | [YoY%]
  const dr = (label, curr, prior, withCagr) => {
    const base = [label, NA, NA, NA, NA]; // Particulars + FY20-FY23 historical
    if (hasPrior) {
      base.push(n(prior));
      base.push(n(curr));
      base.push(yoyStr(curr, prior));
      if (withCagr) base.push(cagr(curr, prior));
    } else {
      base.push(n(curr));
      if (withCagr) base.push(NA);
    }
    return base;
  };

  // Section-header label row
  const sh = (label) => {
    const base = [`── ${label}`, null, null, null, null];
    if (hasPrior) { base.push(null); base.push(null); base.push(null); }
    else { base.push(null); }
    return base;
  };

  // Column widths for financial sheets
  const finCols = hasPrior
    ? [{ wch: 38 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 9 }]
    : [{ wch: 38 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 15 }];

  const finColsPL = hasPrior
    ? [{ wch: 38 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 9 }, { wch: 9 }]
    : [{ wch: 38 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 9 }];

  const colHdrs = hasPrior
    ? ['Particulars', 'FY20', 'FY21', 'FY22', 'FY23', fyLabels.pri, fyLabels.cur, 'YoY %']
    : ['Particulars', 'FY20', 'FY21', 'FY22', 'FY23', fyLabels.cur];

  const colHdrsPL = hasPrior
    ? ['Particulars', 'FY20', 'FY21', 'FY22', 'FY23', fyLabels.pri, fyLabels.cur, 'YoY %', 'CAGR']
    : ['Particulars', 'FY20', 'FY21', 'FY22', 'FY23', fyLabels.cur, 'CAGR'];

  // ── Sheet 0 · Charts Data (inserted first) ────────────────────────────────
  const ebitdaA = n(r2(a.ebitda));
  const netIncA = n(a.netIncome);
  const revenueA = n(a.revenue);
  const ebitdaP = n(r2(p.ebitda));
  const netIncP = n(p.netIncome);
  const revenueP = n(p.revenue);
  const grossMrgA = (revenueA && a.grossProfit != null) ? +((a.grossProfit / revenueA) * 100).toFixed(2) : null;
  const ebitdaMrgA = (revenueA && ebitdaA != null) ? +((ebitdaA / revenueA) * 100).toFixed(2) : null;
  const netMrgA = (revenueA && netIncA != null) ? +((netIncA / revenueA) * 100).toFixed(2) : null;
  const grossMrgP = (revenueP && p.grossProfit != null) ? +((p.grossProfit / revenueP) * 100).toFixed(2) : null;
  const ebitdaMrgP = (revenueP && ebitdaP != null) ? +((ebitdaP / revenueP) * 100).toFixed(2) : null;
  const netMrgP = (revenueP && netIncP != null) ? +((netIncP / revenueP) * 100).toFixed(2) : null;

  const chartRows = [
    [`${name} — Chart Data (Insert Charts in Excel)`],
    [`To create charts: select a data table → Insert → Chart. Suggested chart types are noted in each section.`],
    [''],
    [`SECTION 1: Revenue Trend (${currency} in ${unit}) — Suggested: Line or Column chart`],
    ['Year', 'Revenue', 'EBITDA', 'Net Income'],
    ['FY2020', NA, NA, NA],
    ['FY2021', NA, NA, NA],
    ['FY2022', NA, NA, NA],
    ['FY2023', NA, NA, NA],
    ...(hasPrior ? [[fyLabels.pri, revenueP, ebitdaP, netIncP]] : []),
    [fyLabels.cur, revenueA, ebitdaA, netIncA],
    [''],
    [`SECTION 2: Margin Trends (%) — Suggested: Line chart`],
    ['Year', 'Gross Margin%', 'EBITDA Margin%', 'Net Margin%'],
    ['FY2020', NA, NA, NA],
    ['FY2021', NA, NA, NA],
    ['FY2022', NA, NA, NA],
    ['FY2023', NA, NA, NA],
    ...(hasPrior ? [[fyLabels.pri, grossMrgP, ebitdaMrgP, netMrgP]] : []),
    [fyLabels.cur, grossMrgA, ebitdaMrgA, netMrgA],
    [''],
    [`SECTION 3: Balance Sheet Composition (${currency} in ${unit}) — Suggested: Stacked bar chart`],
    ['Category', fyLabels.cur],
    ['Total Equity', n(a.totalEquity)],
    ['Total Debt', n(a.totalDebt)],
    ['Current Liabilities', n(a.currentLiabilities)],
    [''],
    [`SECTION 4: Cash Flow Summary (${currency} in ${unit}) — Suggested: Clustered column chart`],
    ['Category', fyLabels.cur],
    ['Operating (CFO)', n(a.operatingCashFlow)],
    ['Investing (CFI)', n(a.investingCashFlow)],
    ['Financing (CFF)', n(a.financingCashFlow)],
  ];
  const wsCharts = XLSX.utils.aoa_to_sheet(chartRows);
  wsCharts['!cols'] = [{ wch: 36 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
  // Style chart section headers (rows 3, 12, 21, 26)
  [3, 12, 21, 26].forEach(r => {
    const addr = XLSX.utils.encode_cell({ r, c: 0 });
    if (wsCharts[addr]) wsCharts[addr].s = { ...HDR_STYLE };
  });
  // Style column header rows (rows 4, 13, 22, 27)
  [4, 13, 22, 27].forEach(r => {
    for (let c = 0; c < 4; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (wsCharts[addr]) wsCharts[addr].s = { ...HDR_STYLE };
    }
  });
  wsCharts['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: chartRows.length - 1, c: 3 } });

  // ── Sheet 1 · Cover & Summary (inserted first) ────────────────────────────
  const qualityScore = (() => {
    const criticalFields = ['revenue', 'totalAssets', 'totalEquity', 'totalLiabilities', 'netIncome', 'ebitda', 'pbt', 'currentAssets', 'currentLiabilities', 'operatingCashFlow'];
    const filled = criticalFields.filter(f => a[f] != null && !isNaN(a[f])).length;
    return Math.round((filled / criticalFields.length) * 100);
  })();
  const qualityLabel = qualityScore >= 80 ? 'HIGH — Data complete' : qualityScore >= 50 ? 'MEDIUM — Some gaps' : 'LOW — Extraction limited';

  const coverRows = [
    ['FinSight AI — Financial Analysis Report'],
    [''],
    ['Company Name', name],
    ['CIN', cin || (documentMetadata.isMCA ? 'MCA Filing (CIN not detected)' : '—')],
    ['Reporting Period', period || '—'],
    ['Currency', currency],
    ['Unit', unit],
    ['Document Type', documentMetadata.docType || 'Unknown'],
    ['Indian MCA Filing', documentMetadata.isMCA ? 'Yes' : 'No'],
    [''],
    ['DATA QUALITY ASSESSMENT'],
    ['Overall Score', `${qualityScore}% — ${qualityLabel}`],
    ['Financial Pages Detected', (documentMetadata.financialPageNums || []).length || '—'],
    ['Claude Vision Pages Processed', (documentMetadata.visionPageLog || []).filter(p => p.itemCount > 0).length || '—'],
    ['Sanity Blocks Applied', (visionStructuredData.errorLog || []).length],
    [''],
    ['KEY FINANCIAL METRICS'],
    ['Revenue', a.revenue != null ? `₹${a.revenue.toLocaleString('en-IN')} ${unit}` : '—'],
    ['Net Profit (PAT)', a.netIncome != null ? `₹${a.netIncome.toLocaleString('en-IN')} ${unit}` : '—'],
    ['EBITDA', a.ebitda != null ? `₹${a.ebitda.toLocaleString('en-IN')} ${unit}` : '—'],
    ['Total Assets', a.totalAssets != null ? `₹${a.totalAssets.toLocaleString('en-IN')} ${unit}` : '—'],
    ['Total Equity', a.totalEquity != null ? `₹${a.totalEquity.toLocaleString('en-IN')} ${unit}` : '—'],
    [''],
    ['Prepared by', 'FinSight AI | finsightai.org'],
    ['Generated on', todayStr],
    ['Authors', AUTHOR_NAME],
  ];
  const wsCover = XLSX.utils.aoa_to_sheet(coverRows);
  wsCover['!cols'] = [{ wch: 28 }, { wch: 45 }];
  // Style cover sheet
  const coverTitleAddr = XLSX.utils.encode_cell({ r: 0, c: 0 });
  if (wsCover[coverTitleAddr]) wsCover[coverTitleAddr].s = { ...TITLE_STYLE, font: { ...TITLE_STYLE.font, sz: 16 } };
  ['DATA QUALITY ASSESSMENT', 'KEY FINANCIAL METRICS'].forEach(section => {
    const idx = coverRows.findIndex(r => r[0] === section);
    if (idx >= 0) {
      const a = XLSX.utils.encode_cell({ r: idx, c: 0 });
      if (wsCover[a]) wsCover[a].s = { ...HDR_STYLE };
    }
  });
  XLSX.utils.book_append_sheet(wb, wsCover, 'Cover');
  XLSX.utils.book_append_sheet(wb, wsCharts, 'Chart Data');

  // ── Sheet 2 · P&L ─────────────────────────────────────────────────────────
  const plRows = [
    [`${name} — Profit & Loss Statement`],
    [subHdr],
    [''],
    colHdrsPL,
    sh('REVENUE'),
    dr('Total Revenue',                a.revenue,         p.revenue,         true),
    dr('Cost of Goods Sold (COGS)',     a.cogs,            p.cogs,            true),
    dr('Gross Profit',                 r2(a.grossProfit), r2(p.grossProfit), true),
    [''],
    sh('OPERATING EXPENSES'),
    dr('Depreciation & Amortisation',  a.depreciation,    p.depreciation,    true),
    dr('Interest / Finance Costs',     a.interestExpense, p.interestExpense, true),
    [''],
    sh('PROFITABILITY'),
    dr('EBITDA',                       r2(a.ebitda),      r2(p.ebitda),      true),
    dr('Operating Profit (EBIT)',      r2(a.operatingProfit), r2(p.operatingProfit), true),
    dr('Profit Before Tax (PBT)',      a.pbt,             p.pbt,             true),
    dr('Tax',                          a.tax,             p.tax,             true),
    dr('Net Income / PAT',             a.netIncome,       p.netIncome,       true),
  ];
  const wsPL = XLSX.utils.aoa_to_sheet(plRows);
  wsPL['!cols'] = finColsPL;
  styleSheet(wsPL, plRows, 4, ['gross profit', 'ebitda', 'net income / pat', 'total revenue']);
  XLSX.utils.book_append_sheet(wb, wsPL, 'P&L');

  // ── Sheet 2 · Balance Sheet ───────────────────────────────────────────────
  const bsRows = [
    [`${name} — Balance Sheet`],
    [subHdr],
    [''],
    colHdrs,
    sh('ASSETS'),
    dr('Total Assets',                 a.totalAssets,           p.totalAssets),
    dr('  Current Assets',             a.currentAssets,         p.currentAssets),
    dr('    Cash & Equivalents',       a.cash,                  p.cash),
    dr('    Trade Receivables',        a.receivables,           p.receivables),
    dr('    Inventory',                a.inventory,             p.inventory),
    dr('  Non-Current Assets',         a.nonCurrentAssets,      p.nonCurrentAssets),
    dr('    Fixed Assets / PPE',       a.fixedAssets,           p.fixedAssets),
    [''],
    sh('LIABILITIES'),
    dr('Total Liabilities',            a.totalLiabilities,      p.totalLiabilities),
    dr('  Current Liabilities',        a.currentLiabilities,    p.currentLiabilities),
    dr('    Trade Payables',           a.tradePayables,         p.tradePayables),
    dr('    Short-term Borrowings',    a.shortTermDebt,         p.shortTermDebt),
    dr('  Non-Current Liabilities',    a.nonCurrentLiabilities, p.nonCurrentLiabilities),
    dr('    Long-term Borrowings',     a.longTermDebt,          p.longTermDebt),
    dr('  Total Debt',                 a.totalDebt,             p.totalDebt),
    [''],
    sh('EQUITY'),
    dr('Total Equity / Net Worth',     a.totalEquity,           p.totalEquity),
    [''],
    sh('WORKING CAPITAL'),
    dr('Working Capital',              a.workingCapital,        p.workingCapital),
  ];
  const wsBS = XLSX.utils.aoa_to_sheet(bsRows);
  wsBS['!cols'] = finCols;
  styleSheet(wsBS, bsRows, 4, ['total assets', 'total liabilities', 'total equity / net worth', '  total debt']);
  XLSX.utils.book_append_sheet(wb, wsBS, 'Balance Sheet');

  // ── Sheet 3 · Cash Flow ───────────────────────────────────────────────────
  const cfRows = [
    [`${name} — Cash Flow Statement`],
    [subHdr],
    [''],
    colHdrs,
    dr('Operating Cash Flow (CFO)',    a.operatingCashFlow,  p.operatingCashFlow),
    dr('Investing Cash Flow (CFI)',    a.investingCashFlow,  p.investingCashFlow),
    dr('Financing Cash Flow (CFF)',    a.financingCashFlow,  p.financingCashFlow),
  ];
  // Derive net change only when at least one component is available
  if (a.operatingCashFlow != null || a.investingCashFlow != null || a.financingCashFlow != null) {
    const netC = (a.operatingCashFlow ?? 0) + (a.investingCashFlow ?? 0) + (a.financingCashFlow ?? 0);
    const netP = hasPrior
      ? (p.operatingCashFlow ?? 0) + (p.investingCashFlow ?? 0) + (p.financingCashFlow ?? 0)
      : null;
    cfRows.push(dr('Net Change in Cash', netC, netP));
  }
  const wsCF = XLSX.utils.aoa_to_sheet(cfRows);
  wsCF['!cols'] = finCols;
  styleSheet(wsCF, cfRows, 4, ['net change in cash']);
  XLSX.utils.book_append_sheet(wb, wsCF, 'Cash Flow');

  // ── Sheet 4 · Ratios — with sector benchmarks ─────────────────────────────
  const SECTOR_BENCHMARKS = {
    'Gross Margin (%)':                   '35–45%',
    'Net Margin (%)':                     '8–15%',
    'EBITDA Margin (%)':                  '15–25%',
    'Operating Margin (%)':               '12–20%',
    'Return on Equity (%)':               '12–18%',
    'Return on Assets (%)':               '8–14%',
    'Return on Capital Employed (%)':     '15–20%',
    'Current Ratio':                      '1.5–2.0x',
    'Quick Ratio':                        '1.0–1.5x',
    'Debt-to-Equity':                     '0.3–0.8x',
    'Interest Coverage':                  '3.0–5.0x',
    'Inventory Turnover':                 '4–8x',
    'Receivables Days (DSO)':             '45–75 days',
    'Payable Days (DPO)':                 '30–60 days',
    'Asset Turnover':                     '0.8–1.5x',
  };

  const ratRows = [
    [`${name} — Financial Ratios`],
    [`Period: ${period}  |  Generated: ${todayStr}`],
    [`Benchmarks: Indian Medical Devices & Healthcare Sector`],
    [''],
    ['Category', 'Ratio', 'Value', 'Sector Benchmark', 'Formula', 'Interpretation'],
  ];
  for (const cat of (ratios || [])) {
    for (const item of (cat.items || [])) {
      const rawV = item.rawValue;
      const val  = (rawV != null && !isNaN(rawV) && isFinite(rawV)) ? rawV : '—';
      ratRows.push([
        cat.category        || '',
        item.name           || '',
        val,
        SECTOR_BENCHMARKS[item.name] || '—',
        item.formula        || '',
        item.interpretation || '',
      ]);
    }
    ratRows.push(['', '', '', '', '', '']); // blank separator between categories
  }
  if (swot?.ratioInterpretations?.length) {
    ratRows.push(['Company-Specific Interpretations', '', '', '', '', '']);
    for (const interp of swot.ratioInterpretations) {
      ratRows.push([
        'Company-Specific',
        interp.ratio  || '',
        interp.value  || '—',
        '—',
        '',
        interp.meaning || '',
      ]);
    }
  }
  const wsRatios = XLSX.utils.aoa_to_sheet(ratRows);
  wsRatios['!cols'] = [{ wch: 24 }, { wch: 28 }, { wch: 12 }, { wch: 18 }, { wch: 28 }, { wch: 50 }];
  // Style header row (row 4)
  for (let c = 0; c < 6; c++) {
    const addr = XLSX.utils.encode_cell({ r: 4, c });
    if (wsRatios[addr]) wsRatios[addr].s = { ...HDR_STYLE };
  }
  const ratTitleAddr = XLSX.utils.encode_cell({ r: 0, c: 0 });
  if (wsRatios[ratTitleAddr]) wsRatios[ratTitleAddr].s = TITLE_STYLE;
  XLSX.utils.book_append_sheet(wb, wsRatios, 'Ratios');

  // ── Sheet 5 · SWOT ────────────────────────────────────────────────────────
  const bullets = (arr) =>
    (Array.isArray(arr) ? arr : []).map((s, i) => [`  ${i + 1}. ${String(s).replace(/^[•\-\d.]\s*/, '')}`]);

  const swotRows = [
    [`${name} — SWOT Analysis`],
    [`Period: ${period}  |  Generated by FinSight AI  |  ${todayStr}`],
    [''],
    ['EXECUTIVE OUTLOOK'],
    [swot?.executiveOutlook || '—'],
    [''],
    ['STRENGTHS'],
    ...bullets(swot?.strengths),
    [''],
    ['WEAKNESSES'],
    ...bullets(swot?.weaknesses),
    [''],
    ['OPPORTUNITIES'],
    ...bullets(swot?.opportunities),
    [''],
    ['THREATS'],
    ...bullets(swot?.threats),
  ];
  const wsSWOT = XLSX.utils.aoa_to_sheet(swotRows);
  wsSWOT['!cols'] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, wsSWOT, 'SWOT');

  // ── Validation sheet + cell highlighting ─────────────────────────────────
  try {
    const { years: vYears, sortedYears: vSorted } = wrapAggToYears(aggregated, aggregatedPrior);
    const vRes = validateFinancialData(vYears, vSorted);
    // col offset shifts by +4 (historical N/A columns) — map to expanded column indices
    // Historical cols 1-4 are N/A; actual data starts at col 5 (cur) or 5+6 (pri/cur)
    const colToYrFin = hasPrior ? { 6: 'cur', 5: 'pri' } : { 5: 'cur' };
    applyValidationStyles(wsPL, {
      5:  { section: 'profit_loss', field: 'revenue' },
      7:  { section: 'profit_loss', field: 'gross_profit' },
      10: { section: 'profit_loss', field: 'depreciation' },
      11: { section: 'profit_loss', field: 'interest_expense' },
      14: { section: 'profit_loss', field: 'ebitda' },
      15: { section: 'profit_loss', field: 'ebit' },
      16: { section: 'profit_loss', field: 'pbt' },
      17: { section: 'profit_loss', field: 'tax_expense' },
      18: { section: 'profit_loss', field: 'net_income' },
    }, colToYrFin, vRes.rowFlags, XLSX);
    applyValidationStyles(wsBS, {
      5:  { section: 'balance_sheet', field: 'total_assets' },
      6:  { section: 'balance_sheet', field: 'current_assets' },
      7:  { section: 'balance_sheet', field: 'cash_and_equivalents' },
      10: { section: 'balance_sheet', field: 'non_current_assets' },
      11: { section: 'balance_sheet', field: 'fixed_assets' },
      14: { section: 'balance_sheet', field: 'total_liabilities' },
      15: { section: 'balance_sheet', field: 'current_liabilities' },
      20: { section: 'balance_sheet', field: 'total_debt' },
      23: { section: 'balance_sheet', field: 'total_equity' },
    }, colToYrFin, vRes.rowFlags, XLSX);
    applyValidationStyles(wsCF, {
      4: { section: 'cash_flow', field: 'cfo' },
      5: { section: 'cash_flow', field: 'cfi' },
      6: { section: 'cash_flow', field: 'cff' },
    }, colToYrFin, vRes.rowFlags, XLSX);
    XLSX.utils.book_append_sheet(wb, buildValidationSheet(vRes, XLSX), 'Validation');
  } catch (valErr) {
    console.warn('[FinSight] Validation styling skipped:', valErr.message);
  }

  // ── Sheet 8 · Data Quality Report ─────────────────────────────────────────
  try {
    const vpl = documentMetadata.visionPageLog || [];
    const sanityBlocks = visionStructuredData.errorLog || [];
    const dqRows = [
      [`${name} — Data Quality Report`],
      [`Generated: ${todayStr} | Currency: ${currency} | Unit: ${unit}`],
      [''],
      ['EXTRACTION SUMMARY'],
      ['Total Pages', documentMetadata.totalPages || '—'],
      ['Financial Pages Detected', (documentMetadata.financialPageNums || []).length || '—'],
      ['Document Type', documentMetadata.docType || 'Unknown'],
      ['Currency Detected', currency, documentMetadata.isMCA ? '(MCA filing — forced INR)' : '(auto-detected)'],
      [''],
      ['CLAUDE VISION LOG — FINANCIAL PAGES'],
      ['Page', 'Method', 'Confidence', 'Page Type', 'Items Extracted', 'Notes'],
      ...vpl.map(p => [p.page, p.method || 'Claude Vision', p.confidence || '—', p.pageType || '—', p.itemCount ?? '—', p.error || '']),
      [''],
      ['SANITY VALIDATION BLOCKS'],
      ['Year', 'Field', 'Blocked Value', 'Reason'],
      ...(sanityBlocks.length > 0
        ? sanityBlocks.map(b => [b.yr, b.field, b.blocked_value, b.reason])
        : [['—', '—', '—', 'No figures were blocked — all passed validation']]),
      [''],
      ['RECOMMENDATIONS'],
      ...(qualityScore < 50 ? [
        ['⚠ Data quality is LOW. For better results:'],
        ['1. Download XBRL filing from mca.gov.in → Company search → Financial Statements'],
        ['2. Upload individual pages of Balance Sheet and P&L separately'],
        ['3. Contact support: support@finsightai.org'],
      ] : [
        ['✓ Data quality is sufficient for financial analysis'],
      ]),
    ];
    const wsDQ = XLSX.utils.aoa_to_sheet(dqRows);
    wsDQ['!cols'] = [{ wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 55 }];
    // Style header row for vision log table
    const vLogHeaderRow = dqRows.findIndex(r => r[0] === 'Page' && r[1] === 'Method');
    if (vLogHeaderRow >= 0) {
      for (let c = 0; c < 6; c++) {
        const addr = XLSX.utils.encode_cell({ r: vLogHeaderRow, c });
        if (wsDQ[addr]) wsDQ[addr].s = { ...HDR_STYLE };
      }
    }
    const sanityHeaderRow = dqRows.findIndex(r => r[0] === 'Year' && r[1] === 'Field');
    if (sanityHeaderRow >= 0) {
      for (let c = 0; c < 4; c++) {
        const addr = XLSX.utils.encode_cell({ r: sanityHeaderRow, c });
        if (wsDQ[addr]) wsDQ[addr].s = { ...HDR_STYLE };
      }
    }
    XLSX.utils.book_append_sheet(wb, wsDQ, 'Data Quality');
  } catch (dqErr) {
    console.warn('[FinSight] Data quality sheet skipped:', dqErr.message);
  }

  // ── Serialize ─────────────────────────────────────────────────────────────
  const arrayBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const excelBlob = new Blob([arrayBuf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const fileName = generateSmartFilename(companyInfo, 'xlsx');
  const result = { excelBlob, fileName };
  console.log('generateFinancialExcel result:', {
    keys: Object.keys(result),
    excelBlob: result.excelBlob,
    size: result.excelBlob?.size,
  });
  return result;
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
  const { pdfBlob, pdfFileName, docxBlob, docxFileName, excelBlob, excelFileName,
    briefWordBlob, briefWordFileName, briefWordError, noFinancialData, apiUnavailable,
    extractionWarnings = [],
    selectedOutputs = {}, companyName, summary } = docReady;
  const METHOD_LABEL = { text: 'Text extraction', ocr: 'OCR (Tesseract)', vision: 'Claude Vision OCR', xml: 'XBRL/XML parsing', 'excel-input': 'Excel parsing', word: 'Word extraction' };
  const errBox = (msg) => (
    <div style={{ padding: '10px 14px', background: '#FEF3F2', border: '1px solid #F4B5B5', borderRadius: 8, color: '#9A3412', fontSize: 13, textAlign: 'left', lineHeight: 1.5 }}>
      ⚠ {msg} Other deliverables are unaffected.
    </div>
  );
  const btn = (variant) => {
    const base = { width: "100%", height: 48, borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, transition: "opacity 0.15s", border: "none" };
    if (variant === "primary")   return { ...base, background: C.brown,    color: "#fff" };
    if (variant === "excel")     return { ...base, background: C.green,    color: "#fff" };
    if (variant === "secondary") return { ...base, border: `1.5px solid ${C.border}`, background: C.bgSidebar, color: C.textPrimary };
    return base;
  };
  return (
    <div style={{ width: "100%", maxWidth: 480, margin: "16px auto 0", background: C.bgCard, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: "28px 28px 24px", boxShadow: C.shadowMd, textAlign: "center" }}>
      <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.greenBg, border: `2px solid ${C.green}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 26 }}>✓</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary, marginBottom: 6 }}>Your document is ready!</div>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: C.brown, marginBottom: 16 }}>{companyName}</div>
      {apiUnavailable && (
        <div style={{ background: '#FEF3F2', border: '1px solid #F4B5B5', borderRadius: 10, padding: '10px 14px', marginBottom: 14, textAlign: 'left', fontSize: 12.5, color: '#9A3412', lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠ AI analysis unavailable — API limit reached</div>
          <div>Your Excel workbook has been generated with extracted financial data. AI-generated SWOT, narrative, and PDF/Word analysis will be available once API credits are restored.</div>
          <div style={{ marginTop: 6, color: '#7C3D12', fontSize: 12 }}>A rule-based analysis has been used as a fallback. Your analysis has been queued — when you return and credits are restored, you can regenerate.</div>
        </div>
      )}
      {noFinancialData && !apiUnavailable && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 10, padding: '10px 14px', marginBottom: 14, textAlign: 'left', fontSize: 12.5, color: '#92400E', lineHeight: 1.6 }}>
          ⚠ Limited financial data was extracted. The PDF may contain scanned images instead of text. Try the MCA portal XBRL/text-based PDF version for better results.
        </div>
      )}
      <div style={{ background: C.brownLight, borderRadius: 10, padding: "12px 16px", marginBottom: 20, textAlign: "left" }}>
        {[
          summary.extractionMethod && `Extracted via: ${METHOD_LABEL[summary.extractionMethod] || summary.extractionMethod}`,
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
        {extractionWarnings.map((w, i) => (
          <div key={`w${i}`} style={{ fontSize: 12, color: '#B45309', lineHeight: 1.7, display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 4 }}>
            <span>⚠</span> {w}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {briefWordBlob ? (
          <button style={btn("primary")} onClick={() => triggerBlobDownload(briefWordBlob, briefWordFileName)}>
            <span>📄</span><span>Download Brief Word Note</span>
          </button>
        ) : selectedOutputs.briefWord && briefWordError
          ? errBox(`Brief Word doc failed. Reason: ${briefWordError}`)
          : null
        }
        {excelBlob ? (
          <button style={btn("excel")} onClick={() => {
            try {
              triggerBlobDownload(excelBlob, excelFileName)
            } catch(err) {
              console.error('Excel download error:', err)
            }
          }}>
            <span>📊</span><span>Download Excel Workbook</span>
          </button>
        ) : selectedOutputs.excel && !excelBlob
          ? errBox('Excel workbook generation failed.')
          : null
        }
        {(briefWordBlob || excelBlob) && (pdfBlob || docxBlob) && (
          <div style={{ height: 1, background: C.border, margin: "4px 0" }} />
        )}
        {pdfBlob ? (
          <button style={btn("secondary")} onClick={() => triggerBlobDownload(pdfBlob, pdfFileName)}>
            <span>📕</span>
            <span>Download Detailed PDF{summary.fileSizeKB > 0 ? ` · ${summary.fileSizeKB < 1024 ? summary.fileSizeKB + ' KB' : (summary.fileSizeKB / 1024).toFixed(1) + ' MB'}` : ''}</span>
          </button>
        ) : selectedOutputs.detailedPdf && !pdfBlob
          ? errBox('Detailed PDF generation failed.')
          : null
        }
        {docxBlob ? (
          <button style={btn("secondary")} onClick={() => triggerBlobDownload(docxBlob, docxFileName)}>
            <span>📘</span><span>Download Detailed Word</span>
          </button>
        ) : selectedOutputs.detailedWord && !docxBlob
          ? errBox('Detailed Word doc generation failed.')
          : null
        }
        {!briefWordBlob && !excelBlob && !pdfBlob && !docxBlob && (
          <div style={{ fontSize: 12.5, color: C.red }}>Document generation failed. Please try again.</div>
        )}
      </div>
      <button onClick={onReset} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: C.textSec, textDecoration: "underline" }}>
        ⟲ Process another document
      </button>
    </div>
  );
}

function PendingAnalysisBanner({ onRetry }) {
  const [pending, setPending] = useState(() => getPendingAnalyses());
  const [retrying, setRetrying] = useState(null);

  if (!pending.length) return null;

  const handleRetry = async (item) => {
    setRetrying(item.id);
    try {
      const freshSwot = await generateSWOTAndInterpretation(
        item.companyInfo, item.aggregated, item.ratios, null, item.aggregatedPrior
      );
      const briefNarrative = await generateBriefNarrative(
        item.companyInfo, item.aggregated, item.aggregatedPrior, item.ratios, freshSwot, []
      );
      const briefWordResult = await generateBriefWordDoc(
        [], item.companyInfo, item.aggregated, item.aggregatedPrior, item.ratios, freshSwot, briefNarrative
      );
      if (briefWordResult?.blob) {
        triggerBlobDownload(briefWordResult.blob, briefWordResult.fileName);
        removePendingAnalysis(item.id);
        setPending(getPendingAnalyses());
      }
    } catch (e) {
      if (e.apiUnavailable) {
        alert('API credits still unavailable. Please try again later.');
      } else {
        alert('Retry failed: ' + (e.message || 'Unknown error'));
      }
    }
    setRetrying(null);
    if (onRetry) onRetry();
  };

  const handleDismiss = (id) => {
    removePendingAnalysis(id);
    setPending(getPendingAnalyses());
  };

  return (
    <div style={{ maxWidth: 480, margin: '0 auto 16px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '12px 16px' }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: '#1D4ED8', marginBottom: 8 }}>
        Pending AI Analysis
      </div>
      {pending.map(item => (
        <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid #DBEAFE' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1E3A8A' }}>{item.companyName}</div>
            <div style={{ fontSize: 11.5, color: '#3B82F6' }}>Queued {new Date(item.queuedAt).toLocaleDateString()}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              disabled={retrying === item.id}
              onClick={() => handleRetry(item)}
              style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, border: 'none', background: retrying === item.id ? '#93C5FD' : '#2563EB', color: '#fff', cursor: retrying === item.id ? 'default' : 'pointer' }}
            >
              {retrying === item.id ? 'Generating...' : 'Generate now'}
            </button>
            <button
              onClick={() => handleDismiss(item.id)}
              style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid #93C5FD', background: 'transparent', color: '#1D4ED8', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const PIPELINE_STEPS = [
  { id: 'read',    label: 'Reading document',            icon: '📄' },
  { id: 'split',   label: 'Splitting into sections',     icon: '🔍' },
  { id: 'extract', label: 'Extracting financial data',   icon: '📊' },
  { id: 'analyse', label: 'Calculating ratios & SWOT',   icon: '🔢' },
  { id: 'excel',   label: 'Building Excel workbook',     icon: '📑' },
  { id: 'docs',    label: 'Generating documents',        icon: '📝' },
];

function getStepIndex(msg) {
  if (!msg) return -1;
  // Test from last step to first so more-specific patterns win
  if (/generating.*pdf|generating.*word|generating company narr|building brief|generating brief|generating detailed|pdf generation|large document.*pdf/i.test(msg)) return 5;
  if (/generating excel|building excel workbook|excel ready|scanned.*vision extraction|📊 building excel/i.test(msg)) return 4;
  if (/calculating.*ratio|generating swot|building bar chart|done:.*section/i.test(msg)) return 3;
  if (/processing section|processed section|🤖 claude vision|extracting financials from pages|✅.*data extracted/i.test(msg)) return 2;
  if (/splitting document|document has \d+.*section|beginning ai|beginning.*processing/i.test(msg)) return 1;
  if (/reading your document|📄 reading|running ocr|🔍 running ocr|scanned pdf|claude vision ocr|running claude vision/i.test(msg)) return 0;
  return -1;
}

function ProcessingSteps({ progress, error, elapsedSecs }) {
  const hwRef = useRef(-1);
  const stepIdx = getStepIndex(progress);
  if (stepIdx > hwRef.current) hwRef.current = stepIdx;
  // Default to step 0 so the first step shows active immediately
  const hw = hwRef.current === -1 ? 0 : hwRef.current;

  const pageMatch = progress?.match(/\((\d+)\/(\d+)\)/);
  const chunkMatch = progress?.match(/section (\d+) of (\d+)/i);

  const mins = Math.floor(elapsedSecs / 60);
  const secs = elapsedSecs % 60;
  const elapsedStr = mins > 0 ? `${mins}m ${String(secs).padStart(2, '0')}s` : `${elapsedSecs}s`;

  const getState = (i) => {
    if (error && i === hw) return 'error';
    if (i < hw) return 'done';
    if (i === hw) return 'active';
    return 'pending';
  };

  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 24px', boxShadow: C.shadowMd }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 10 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: C.textPrimary }}>Processing your document</div>
        <div style={{ fontSize: 12, color: C.textSec, background: C.brownLight, borderRadius: 20, padding: '3px 10px', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
          ⏱ {elapsedStr}
        </div>
      </div>
      {PIPELINE_STEPS.map((step, i) => {
        const state = getState(i);
        const isLast = i === PIPELINE_STEPS.length - 1;
        return (
          <div key={step.id} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            {/* Circle + connector line */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: state === 'done' ? C.green : state === 'active' ? C.amberBg : state === 'error' ? C.redBg : '#FAFAFA',
                border: `2px solid ${state === 'done' ? C.green : state === 'active' ? C.amber : state === 'error' ? C.red : C.border}`,
                transition: 'background 0.3s, border-color 0.3s',
              }}>
                {state === 'done' && <span style={{ color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                {state === 'active' && (
                  <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', border: `2px solid ${C.amber}`, borderTopColor: 'transparent', animation: 'fs-spin 0.8s linear infinite' }} />
                )}
                {state === 'error' && <span style={{ color: C.red, fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✕</span>}
                {state === 'pending' && <span style={{ color: C.textMuted, fontSize: 10, fontWeight: 600 }}>{i + 1}</span>}
              </div>
              {!isLast && (
                <div style={{ width: 2, flex: 1, minHeight: 20, marginTop: 2, marginBottom: 2, borderRadius: 1, background: state === 'done' ? C.green : C.border, opacity: state === 'done' ? 0.4 : 0.2, transition: 'background 0.3s' }} />
              )}
            </div>
            {/* Label + subtext */}
            <div style={{ flex: 1, paddingBottom: isLast ? 0 : 16, paddingTop: 4 }}>
              <div style={{
                fontSize: 13.5,
                fontWeight: state === 'active' ? 700 : 500,
                color: state === 'done' ? C.textSec : state === 'active' ? C.textPrimary : state === 'error' ? C.red : C.textMuted,
                display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap',
                transition: 'color 0.2s',
              }}>
                <span>{step.icon}</span>
                <span>{step.label}</span>
                {state === 'active' && pageMatch && i === 0 && (
                  <span style={{ fontSize: 12, fontWeight: 400, color: C.textSec }}>({pageMatch[1]} / {pageMatch[2]})</span>
                )}
              </div>
              {state === 'active' && progress && (
                <div style={{ fontSize: 11.5, color: C.textSec, marginTop: 4, fontStyle: 'italic', lineHeight: 1.5, wordBreak: 'break-word' }}>
                  {progress}
                </div>
              )}
              {state === 'active' && chunkMatch && i === 2 && (() => {
                const done = parseInt(chunkMatch[1], 10);
                const total = parseInt(chunkMatch[2], 10);
                const pct = Math.round((done / total) * 100);
                return (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.textMuted, marginBottom: 3 }}>
                      <span>Sections processed</span><span>{done} / {total}</span>
                    </div>
                    <div style={{ height: 5, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: C.brown, borderRadius: 3, transition: 'width 0.4s ease' }} />
                    </div>
                  </div>
                );
              })()}
              {state === 'error' && error && (
                <div style={{ fontSize: 12, color: C.red, marginTop: 4, lineHeight: 1.5 }}>{error}</div>
              )}
            </div>
          </div>
        );
      })}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}`, fontSize: 11.5, color: C.textMuted, textAlign: 'center' }}>
        Multi-pass processing — typically 3–5 minutes for large documents
      </div>
    </div>
  );
}

function PrivateDocUploadZone({ onFileSelected, isProcessing, progress, error }) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const startTimeRef = useRef(null);

  useEffect(() => {
    if (!isProcessing) { setElapsedSecs(0); startTimeRef.current = null; return; }
    startTimeRef.current = Date.now();
    const timer = setInterval(() => setElapsedSecs(Math.floor((Date.now() - startTimeRef.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [isProcessing]);

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e) => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0]); };
  const handleFile = (file) => {
    if (!file) return;
    if (!file.name.match(/\.(pdf|docx?|doc|xml|xbrl|xlsx?)$/i)) { alert("Please upload a PDF, Word document, XBRL XML, or Excel file (.pdf, .docx, .xml, .xlsx)"); return; }
    onFileSelected(file);
  };

  return (
    <div style={{ width: "100%", maxWidth: 720, margin: "16px auto 0" }}>
      {isProcessing ? (
        <ProcessingSteps progress={progress} error={error} elapsedSecs={elapsedSecs} />
      ) : (
        <>
          <div
            onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{ padding: "28px 24px", background: isDragging ? C.brownLight : C.bgCard, border: `2px dashed ${isDragging ? C.brown : C.border}`, borderRadius: 14, cursor: "pointer", transition: "all 0.2s", textAlign: "center", boxShadow: C.shadow }}
          >
            <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xml,.xbrl,.xlsx,.xls" onChange={(e) => handleFile(e.target.files[0])} style={{ display: "none" }} />
            <div style={{ fontSize: 32, marginBottom: 10 }}>📄</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, marginBottom: 6 }}>Upload Private Company Financials</div>
            <div style={{ fontSize: 12.5, color: C.textSec, marginBottom: 8 }}>Upload PDF or Word document — drag & drop here, or click to browse</div>
            <div style={{ fontSize: 11, color: C.textMuted, fontStyle: "italic" }}>Clean XBRL output · Times New Roman · Page borders · Bar charts · SWOT · Ratio interpretations</div>
          </div>
          {error && (
            <div style={{ marginTop: 12, padding: "10px 14px", background: C.redBg, border: `1px solid ${C.red}`, borderRadius: 8, fontSize: 12.5, color: C.red }}>⚠ {error}</div>
          )}
        </>
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
  .fs-deliverable-row:hover { background: #EDE5D8 !important; border-color: ${C.brown} !important; }
`;

function DeliverableSelectionScreen({ file, selectedOutputs, onToggle, onCancel, onGenerate }) {
  const hasBriefWordImpl = typeof generateBriefWordDoc === 'function';

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const anySelected = Object.entries(selectedOutputs).some(([k, v]) => {
    if (k === 'briefWord' && !hasBriefWordImpl) return false;
    return v;
  });

  const estimatedMinutes =
    3 +
    (selectedOutputs.briefWord && hasBriefWordImpl ? 3 : 0) +
    (selectedOutputs.excel ? 2 : 0) +
    (selectedOutputs.detailedPdf ? 5 : 0) +
    (selectedOutputs.detailedWord ? 5 : 0);

  const mainOptions = [
    { key: 'briefWord',   icon: '📄', label: 'Brief Company Note',      format: 'Word',  desc: '12–15 page executive brief — recommended', time: '~3 min', recommended: true,  comingSoon: !hasBriefWordImpl },
    { key: 'excel',       icon: '📊', label: 'Financial Excel Workbook', format: 'Excel', desc: '3-tab analysis with all ratios — recommended', time: '~2 min', recommended: true,  comingSoon: false },
  ];
  const advancedOptions = [
    { key: 'detailedPdf',  icon: '📕', label: 'Detailed Organised PDF',  format: 'PDF',  desc: 'Full 100+ page formatted document',  time: '~8 min', recommended: false, comingSoon: false },
    { key: 'detailedWord', icon: '📘', label: 'Detailed Organised Word', format: 'Word', desc: 'Full 100+ page Word version',          time: '~8 min', recommended: false, comingSoon: false },
  ];

  const OptionRow = ({ opt }) => {
    const checked = !opt.comingSoon && selectedOutputs[opt.key];
    return (
      <label
        htmlFor={`opt-${opt.key}`}
        className={opt.comingSoon ? '' : 'fs-deliverable-row'}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px',
          background: opt.recommended ? C.brownLight : C.bgCard,
          border: `1.5px solid ${checked ? C.brown : C.border}`,
          borderRadius: 10, cursor: opt.comingSoon ? 'default' : 'pointer',
          opacity: opt.comingSoon ? 0.6 : 1, transition: 'border-color 0.15s',
        }}
      >
        <input
          id={`opt-${opt.key}`} type="checkbox"
          checked={checked} disabled={opt.comingSoon}
          onChange={() => !opt.comingSoon && onToggle(opt.key)}
          style={{ marginTop: 3, accentColor: C.brown, width: 16, height: 16,
            cursor: opt.comingSoon ? 'default' : 'pointer', flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
            <span style={{ fontSize: 15 }}>{opt.icon}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>{opt.label}</span>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: C.textMuted, background: C.bgSidebar, border: `1px solid ${C.border}`, borderRadius: 4, padding: '1px 6px' }}>{opt.format}</span>
            {opt.comingSoon && <span style={{ fontSize: 10, fontWeight: 700, color: C.amber, background: C.amberBg, border: `1px solid ${C.amber}`, borderRadius: 4, padding: '1px 6px' }}>COMING SOON</span>}
            {opt.recommended && !opt.comingSoon && <span style={{ fontSize: 10, fontWeight: 700, color: C.green, background: C.greenBg, border: `1px solid ${C.green}`, borderRadius: 4, padding: '1px 6px' }}>RECOMMENDED</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12.5, color: C.textSec }}>{opt.desc}</span>
            <span style={{ fontSize: 11.5, color: C.textMuted, flexShrink: 0 }}>{opt.time}</span>
          </div>
        </div>
      </label>
    );
  };

  return (
    <div style={{ width: '100%', maxWidth: 600, margin: '16px auto 0', background: C.bgCard, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: '28px 28px 24px', boxShadow: C.shadowMd }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>Choose Your Deliverables</div>
        <div style={{ fontSize: 13.5, color: C.textSec }}>Pick what you want generated from this filing</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: C.bgSidebar, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 20 }}>
        <span style={{ fontSize: 16 }}>📁</span>
        <span style={{ fontSize: 13, color: C.textSec, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file?.name}</span>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: C.accent, fontWeight: 600, flexShrink: 0, padding: 0 }}>Change File</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
        {mainOptions.map(opt => <OptionRow key={opt.key} opt={opt} />)}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, height: 1, background: C.border }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: '0.08em' }}>ADVANCED OPTIONS</span>
        <div style={{ flex: 1, height: 1, background: C.border }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        {advancedOptions.map(opt => <OptionRow key={opt.key} opt={opt} />)}
      </div>

      <div style={{ padding: '10px 14px', background: C.brownLight, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: anySelected ? 20 : 10, fontSize: 13, color: C.brown, fontWeight: 500 }}>
        ⏱ Estimated processing time: ~{estimatedMinutes} minutes
      </div>

      {!anySelected && (
        <div style={{ marginBottom: 16, fontSize: 12.5, color: C.amber, textAlign: 'center', fontWeight: 500 }}>
          Select at least one deliverable to continue
        </div>
      )}

      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={onCancel} style={{ flex: 1, height: 46, borderRadius: 10, border: `1.5px solid ${C.border}`, background: C.bgSidebar, color: C.textPrimary, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
        <button
          onClick={anySelected ? onGenerate : undefined}
          disabled={!anySelected}
          style={{ flex: 2, height: 46, borderRadius: 10, border: 'none', background: anySelected ? C.brown : C.border, color: anySelected ? '#fff' : C.textMuted, fontSize: 14, fontWeight: 600, cursor: anySelected ? 'pointer' : 'default', transition: 'background 0.15s' }}
        >
          Generate Selected →
        </button>
      </div>
    </div>
  );
}

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
  const [selectedOutputs, setSelectedOutputs] = useState({ briefWord: true, excel: true, detailedPdf: false, detailedWord: false });
  const [privateDocStage, setPrivateDocStage] = useState('idle');
  const [privateDocFile, setPrivateDocFile] = useState(null);
  const [scannedPdfWarn, setScannedPdfWarn] = useState(null);

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

  const handlePrivateFileSelected = (file) => {
    setPrivateDocFile(file);
    setPrivateDocError("");
    setPrivateDocStage('uploaded');
  };

  const runPrivateDocProcess = async (file, outputs) => {
    setPrivateDocLoading(true); setPrivateDocError(""); setPrivateDocProgress(""); setDocReady(null);
    setScannedPdfWarn(null);
    setPrivateDocStage('processing');
    try {
      const result = await processPrivateCompanyDoc(file, outputs, (msg) => setPrivateDocProgress(msg));
      setDocReady({
        pdfBlob: result.pdfBlob,
        pdfFileName: result.pdfFileName,
        docxBlob: result.docxBlob,
        docxFileName: result.docxFileName,
        excelBlob: result.excelBlob,
        excelFileName: result.excelFileName,
        briefWordBlob: result.briefWordBlob,
        briefWordFileName: result.briefWordFileName,
        briefWordError: result.briefWordError,
        noFinancialData: result.noFinancialData,
        apiUnavailable: result.apiUnavailable,
        extractionMethod: result.extractionMethod,
        extractionWarnings: result.extractionWarnings,
        selectedOutputs: outputs,
        companyName: result.companyInfo?.name || 'Private Company',
        summary: {
          sectionCount: result.sectionCount,
          ratioCount: result.ratioCount,
          hasSWOT: result.hasSWOT,
          hasCharts: result.hasCharts,
          fileSizeKB: result.pdfFileSizeKB,
          failedChunks: result.failedChunks,
          extractionMethod: result.extractionMethod,
        }
      });
      setPrivateDocLoading(false);
      setPrivateDocProgress("");
    } catch (e) {
      setPrivateDocError(e.message || "Failed to process document.");
      setPrivateDocLoading(false);
      setPrivateDocProgress("");
      setPrivateDocStage('uploaded');
    }
  };

  const handlePrivateDocProcess = async (file, outputs) => {
    try {
      const textCheck = await checkPdfHasText(file);
      if (!textCheck.hasText) {
        setScannedPdfWarn({ file, outputs, charsPerPage: textCheck.charsPerPage, totalPages: textCheck.totalPages });
        return;
      }
    } catch { /* if check fails, proceed anyway */ }
    await runPrivateDocProcess(file, outputs);
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

<PendingAnalysisBanner />
        {docReady
          ? <DocumentReadyScreen docReady={docReady} onReset={() => { setDocReady(null); setPrivateDocStage('idle'); setPrivateDocFile(null); setScannedPdfWarn(null); }} />
          : privateDocStage === 'uploaded'
            ? <DeliverableSelectionScreen
                file={privateDocFile}
                selectedOutputs={selectedOutputs}
                onToggle={(key) => setSelectedOutputs(prev => ({ ...prev, [key]: !prev[key] }))}
                onCancel={() => { setPrivateDocStage('idle'); setPrivateDocFile(null); setPrivateDocError(""); }}
                onGenerate={() => handlePrivateDocProcess(privateDocFile, selectedOutputs)}
              />
          : scannedPdfWarn
            ? (
              <div style={{ width: "100%", maxWidth: 480, margin: "16px auto 0", background: C.bgCard, border: `1.5px solid #FCD34D`, borderRadius: 14, padding: "24px 24px 20px", boxShadow: C.shadowMd }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#92400E', marginBottom: 10 }}>⚠ PDF Appears to Be Scanned</div>
                <div style={{ fontSize: 13, color: C.textSec, lineHeight: 1.7, marginBottom: 16 }}>
                  Only ~{scannedPdfWarn.charsPerPage} characters per page detected across the first 3 pages — this suggests the PDF contains scanned images rather than searchable text.
                  <br /><br />
                  Extraction may return limited or no financial data. For best results, use an MCA portal XBRL/text-based PDF.
                  <br /><br />
                  You can still proceed — structured sections will be organised, but financial tables may be empty.
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => { setScannedPdfWarn(null); setPrivateDocStage('idle'); setPrivateDocFile(null); }}
                    style={{ flex: 1, height: 42, borderRadius: 10, border: `1.5px solid ${C.border}`, background: C.bgSidebar, color: C.textPrimary, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button onClick={() => runPrivateDocProcess(scannedPdfWarn.file, scannedPdfWarn.outputs)}
                    style={{ flex: 2, height: 42, borderRadius: 10, border: 'none', background: '#D97706', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    Proceed Anyway →
                  </button>
                </div>
              </div>
            )
            : <PrivateDocUploadZone
                  onFileSelected={handlePrivateFileSelected}
                  isProcessing={privateDocLoading}
                  progress={privateDocProgress}
                  error={privateDocError}
                />
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
