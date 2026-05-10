import { useState, useEffect, useRef } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, ComposedChart, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList
} from "recharts";
import { ClerkProvider, SignedIn, SignedOut, SignIn, SignUp, UserButton, useUser } from "@clerk/clerk-react";

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
  brown:       "#8B4513",
  brownLight:  "#F5EFE7",
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

function cleanText(text) {
  if (!text) return text;
  if (Array.isArray(text)) return text.map(cleanText);
  if (typeof text !== 'string') return text;
  return text
    .replace(/<cite[^>]*>/gi, '')
    .replace(/<\/cite>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
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

function buildPrivateCompanyPrompt() {
  return `You are a financial document organizer. You will receive raw text from a private company's financial document. Your task is to EXTRACT and ORGANIZE the data EXACTLY as provided.

CRITICAL RULES:
1. Use ONLY data present in the document. NEVER invent numbers.
2. If data is missing, mark it as "NA" or omit the section.
3. Do NOT add opinions, recommendations, or analysis.
4. Do NOT bring in external information.
5. Calculate ratios ONLY if both required values are present.
6. Preserve exact numbers from the document.

OUTPUT: Return ONLY raw JSON in this exact structure:

{
  "companyInfo": {
    "name": "extracted name or NA",
    "cin": "if mentioned",
    "pan": "if mentioned",
    "address": "if mentioned",
    "industry": "if mentioned",
    "incorporationDate": "if mentioned",
    "reportingPeriod": "extract the period covered",
    "currency": "INR or USD or extract",
    "rounding": "Lakhs/Crores/Millions/etc - extract or default to 'Lakhs'",
    "businessNature": "1-2 sentence factual description from document",
    "description": "Brief description if available in document"
  },
  "balanceSheet": {
    "available": true/false,
    "asOfDates": ["31/03/2025", "31/03/2024"],
    "equity": {
      "shareCapital": [val1, val2],
      "reservesAndSurplus": [val1, val2],
      "totalEquity": [val1, val2]
    },
    "nonCurrentLiabilities": {
      "longTermBorrowings": [val1, val2],
      "deferredTaxLiabilities": [val1, val2],
      "otherNonCurrentLiabilities": [val1, val2],
      "totalNonCurrent": [val1, val2]
    },
    "currentLiabilities": {
      "shortTermBorrowings": [val1, val2],
      "tradePayables": [val1, val2],
      "otherCurrentLiabilities": [val1, val2],
      "shortTermProvisions": [val1, val2],
      "totalCurrent": [val1, val2]
    },
    "totalEquityLiabilities": [val1, val2],
    "nonCurrentAssets": {
      "propertyPlantEquipment": [val1, val2],
      "intangibleAssets": [val1, val2],
      "investments": [val1, val2],
      "otherNonCurrentAssets": [val1, val2],
      "totalNonCurrentAssets": [val1, val2]
    },
    "currentAssets": {
      "inventories": [val1, val2],
      "tradeReceivables": [val1, val2],
      "cashAndEquivalents": [val1, val2],
      "shortTermLoansAndAdvances": [val1, val2],
      "otherCurrentAssets": [val1, val2],
      "totalCurrentAssets": [val1, val2]
    },
    "totalAssets": [val1, val2]
  },
  "profitAndLoss": {
    "available": true/false,
    "periods": ["FY24-25", "FY23-24"],
    "revenue": {
      "revenueFromOperations": [val1, val2],
      "otherIncome": [val1, val2],
      "totalRevenue": [val1, val2]
    },
    "expenses": {
      "costOfMaterials": [val1, val2],
      "purchaseOfStockInTrade": [val1, val2],
      "changesInInventories": [val1, val2],
      "employeeBenefits": [val1, val2],
      "financeCosts": [val1, val2],
      "depreciation": [val1, val2],
      "otherExpenses": [val1, val2],
      "totalExpenses": [val1, val2]
    },
    "profitBeforeTax": [val1, val2],
    "taxExpense": [val1, val2],
    "profitForPeriod": [val1, val2],
    "earningsPerShare": {
      "basic": [val1, val2],
      "diluted": [val1, val2]
    }
  },
  "cashFlow": {
    "available": true/false,
    "periods": ["FY24-25", "FY23-24"],
    "operating": {
      "profitBeforeTax": [val1, val2],
      "adjustments": [val1, val2],
      "workingCapitalChanges": [val1, val2],
      "taxesPaid": [val1, val2],
      "netCashFromOperating": [val1, val2]
    },
    "investing": {
      "purchaseOfFixedAssets": [val1, val2],
      "saleOfFixedAssets": [val1, val2],
      "investmentsMade": [val1, val2],
      "interestReceived": [val1, val2],
      "netCashFromInvesting": [val1, val2]
    },
    "financing": {
      "proceedsFromBorrowings": [val1, val2],
      "repaymentOfBorrowings": [val1, val2],
      "interestPaid": [val1, val2],
      "dividendPaid": [val1, val2],
      "netCashFromFinancing": [val1, val2]
    },
    "netChangeInCash": [val1, val2],
    "openingCash": [val1, val2],
    "closingCash": [val1, val2]
  },
  "ratios": {
    "calculated": true/false,
    "profitability": {
      "grossMargin": "X% or NA",
      "operatingMargin": "X% or NA",
      "netMargin": "X% or NA",
      "returnOnEquity": "X% or NA",
      "returnOnAssets": "X% or NA"
    },
    "liquidity": {
      "currentRatio": "X.XX or NA",
      "quickRatio": "X.XX or NA",
      "cashRatio": "X.XX or NA"
    },
    "leverage": {
      "debtToEquity": "X.XX or NA",
      "interestCoverage": "X.XX or NA",
      "debtToAssets": "X.XX or NA"
    },
    "efficiency": {
      "assetTurnover": "X.XX or NA",
      "inventoryTurnover": "X.XX or NA",
      "receivablesDays": "X days or NA"
    }
  },
  "otherNotes": [
    {
      "noteNumber": "1",
      "title": "Note title",
      "content": "Note content as in document"
    }
  ],
  "extractionNotes": {
    "sectionsFound": ["balance_sheet", "profit_loss", "cash_flow", "notes"],
    "sectionsMissing": ["list of expected sections not in document"],
    "dataQuality": "High/Medium/Low - based on completeness"
  }
}

REMEMBER:
- ONLY use data from the document
- Mark missing values as null or "NA"
- Set "available: false" if entire section is missing
- Calculate ratios ONLY when both required values exist
- Return clean JSON with no markdown, no explanations`;
}

async function generatePrivateCompanyDoc(data, originalFileName) {
  const docx = await loadDocx();
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    BorderStyle, AlignmentType, WidthType, PageNumber, Header, Footer, ShadingType
  } = docx;

  const BLACK = "000000";

  const cellBorder = {
    top: { style: BorderStyle.SINGLE, size: 4, color: BLACK },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: BLACK },
    left: { style: BorderStyle.SINGLE, size: 4, color: BLACK },
    right: { style: BorderStyle.SINGLE, size: 4, color: BLACK },
  };

  const text = (str, opts = {}) => new TextRun({
    text: String(str || ""),
    font: opts.font || "Arial",
    size: opts.size || 18,
    bold: opts.bold || false,
    italics: opts.italics || false,
    color: opts.color || BLACK,
    ...opts
  });

  const para = (children, opts = {}) => new Paragraph({
    children: Array.isArray(children) ? children : [children],
    alignment: opts.align || AlignmentType.LEFT,
    spacing: opts.spacing || { before: 100, after: 100 },
    ...opts
  });

  const cell = (children, opts = {}) => new TableCell({
    children: Array.isArray(children) ? children : [children],
    borders: cellBorder,
    width: opts.width,
    shading: opts.shading,
    verticalAlign: "center",
    ...opts
  });

  const numCell = (value, opts = {}) => cell(
    para(text(value != null && value !== "NA" ? formatNumber(value) : "—", { font: "Arial", size: 18, ...(opts.textOpts || {}) }), { align: AlignmentType.RIGHT }),
    opts
  );

  const labelCell = (label, opts = {}) => cell(
    para(text(label, { font: "Arial", size: 18, ...(opts.textOpts || {}) }), { align: AlignmentType.LEFT }),
    opts
  );

  const sectionHeader = (number, title) => para(
    [text(`[${number}] ${title}`, { font: "Times New Roman", size: 24, bold: true, color: BLACK })],
    { align: AlignmentType.CENTER, spacing: { before: 400, after: 200 } }
  );

  const disclaimer = (curr) => para(
    [text(`Unless otherwise specified, all monetary values are in ${curr || "Lakhs"} of INR`, {
      font: "Times New Roman", size: 18, italics: true
    })],
    { align: AlignmentType.RIGHT, spacing: { before: 100, after: 200 } }
  );

  function formatNumber(val) {
    if (val == null || val === "NA" || val === "") return "—";
    if (typeof val === 'string' && isNaN(parseFloat(val))) return val;
    const num = parseFloat(val);
    if (isNaN(num)) return val;
    return num.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  const ci = data.companyInfo || {};
  const bs = data.balanceSheet || {};
  const pl = data.profitAndLoss || {};
  const cf = data.cashFlow || {};
  const ratios = data.ratios || {};
  const notes = data.otherNotes || [];

  const allSections = [];

  allSections.push(para(
    [text(ci.name || "PRIVATE COMPANY", {
      font: "Times New Roman", size: 28, bold: true
    })],
    { align: AlignmentType.CENTER, spacing: { before: 200, after: 100 } }
  ));

  allSections.push(para(
    [text(`Standalone Financial Statements for period ${ci.reportingPeriod || ""}`, {
      font: "Times New Roman", size: 22
    })],
    { align: AlignmentType.CENTER, spacing: { before: 100, after: 400 } }
  ));

  allSections.push(sectionHeader("400100", "Disclosure of general information about company"));
  allSections.push(disclaimer(ci.rounding));

  const infoRows = [
    ["Name of company", ci.name],
    ["Corporate identity number", ci.cin],
    ["Permanent account number of entity", ci.pan],
    ["Address of registered office of company", ci.address],
    ["Type of industry", ci.industry],
    ["Date of incorporation", ci.incorporationDate],
    ["Period covered by financial statements", ci.reportingPeriod],
    ["Description of presentation currency", ci.currency || "INR"],
    ["Level of rounding used in financial statements", ci.rounding || "Lakhs"],
    ["Nature of report", "Standalone"],
    ["Content of report", "Financial Statements"],
  ];

  if (ci.businessNature) {
    infoRows.push(["Description of nature of business", ci.businessNature]);
  }

  const infoTable = new Table({
    rows: infoRows.map(([label, value]) => new TableRow({
      children: [
        cell(para(text(label, { font: "Arial", size: 18 }))),
        cell(para(text(value || "NA", { font: "Arial", size: 18 }))),
      ]
    })),
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
  allSections.push(infoTable);

  if (bs.available) {
    allSections.push(sectionHeader("400200", "Balance Sheet"));
    allSections.push(disclaimer(ci.rounding));

    const dates = bs.asOfDates || ["Current Year", "Previous Year"];

    const bsRows = [
      new TableRow({
        tableHeader: true,
        children: [
          cell(para(text("Particulars", { font: "Arial", size: 18, bold: true })),
               { shading: { type: ShadingType.SOLID, color: "F0F0F0" } }),
          cell(para(text(`As at ${dates[0] || ""}`, { font: "Arial", size: 18, bold: true }), { align: AlignmentType.CENTER }),
               { shading: { type: ShadingType.SOLID, color: "F0F0F0" } }),
          cell(para(text(`As at ${dates[1] || ""}`, { font: "Arial", size: 18, bold: true }), { align: AlignmentType.CENTER }),
               { shading: { type: ShadingType.SOLID, color: "F0F0F0" } }),
        ]
      }),
    ];

    bsRows.push(new TableRow({ children: [
      cell(para(text("EQUITY AND LIABILITIES", { font: "Arial", size: 18, bold: true })),
           { shading: { type: ShadingType.SOLID, color: "FAFAFA" } }),
      cell(para(text(""))),
      cell(para(text(""))),
    ]}));

    if (bs.equity) {
      bsRows.push(new TableRow({ children: [
        labelCell("Shareholders' Funds", { textOpts: { bold: true } }),
        cell(para(text(""))), cell(para(text(""))),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Share Capital"),
        numCell(bs.equity.shareCapital?.[0]),
        numCell(bs.equity.shareCapital?.[1]),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Reserves and Surplus"),
        numCell(bs.equity.reservesAndSurplus?.[0]),
        numCell(bs.equity.reservesAndSurplus?.[1]),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Total Equity", { textOpts: { bold: true } }),
        numCell(bs.equity.totalEquity?.[0], { textOpts: { bold: true } }),
        numCell(bs.equity.totalEquity?.[1], { textOpts: { bold: true } }),
      ]}));
    }

    if (bs.nonCurrentLiabilities) {
      bsRows.push(new TableRow({ children: [
        labelCell("Non-Current Liabilities", { textOpts: { bold: true } }),
        cell(para(text(""))), cell(para(text(""))),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Long-term Borrowings"),
        numCell(bs.nonCurrentLiabilities.longTermBorrowings?.[0]),
        numCell(bs.nonCurrentLiabilities.longTermBorrowings?.[1]),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Deferred Tax Liabilities"),
        numCell(bs.nonCurrentLiabilities.deferredTaxLiabilities?.[0]),
        numCell(bs.nonCurrentLiabilities.deferredTaxLiabilities?.[1]),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Other Non-Current Liabilities"),
        numCell(bs.nonCurrentLiabilities.otherNonCurrentLiabilities?.[0]),
        numCell(bs.nonCurrentLiabilities.otherNonCurrentLiabilities?.[1]),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Total Non-Current Liabilities", { textOpts: { bold: true } }),
        numCell(bs.nonCurrentLiabilities.totalNonCurrent?.[0], { textOpts: { bold: true } }),
        numCell(bs.nonCurrentLiabilities.totalNonCurrent?.[1], { textOpts: { bold: true } }),
      ]}));
    }

    if (bs.currentLiabilities) {
      bsRows.push(new TableRow({ children: [
        labelCell("Current Liabilities", { textOpts: { bold: true } }),
        cell(para(text(""))), cell(para(text(""))),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Short-term Borrowings"),
        numCell(bs.currentLiabilities.shortTermBorrowings?.[0]),
        numCell(bs.currentLiabilities.shortTermBorrowings?.[1]),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Trade Payables"),
        numCell(bs.currentLiabilities.tradePayables?.[0]),
        numCell(bs.currentLiabilities.tradePayables?.[1]),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Other Current Liabilities"),
        numCell(bs.currentLiabilities.otherCurrentLiabilities?.[0]),
        numCell(bs.currentLiabilities.otherCurrentLiabilities?.[1]),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Short-term Provisions"),
        numCell(bs.currentLiabilities.shortTermProvisions?.[0]),
        numCell(bs.currentLiabilities.shortTermProvisions?.[1]),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Total Current Liabilities", { textOpts: { bold: true } }),
        numCell(bs.currentLiabilities.totalCurrent?.[0], { textOpts: { bold: true } }),
        numCell(bs.currentLiabilities.totalCurrent?.[1], { textOpts: { bold: true } }),
      ]}));
    }

    bsRows.push(new TableRow({ children: [
      labelCell("TOTAL EQUITY AND LIABILITIES", { textOpts: { bold: true } }),
      numCell(bs.totalEquityLiabilities?.[0], { textOpts: { bold: true }, shading: { type: ShadingType.SOLID, color: "F5F5F5" } }),
      numCell(bs.totalEquityLiabilities?.[1], { textOpts: { bold: true }, shading: { type: ShadingType.SOLID, color: "F5F5F5" } }),
    ]}));

    bsRows.push(new TableRow({ children: [
      cell(para(text("ASSETS", { font: "Arial", size: 18, bold: true })),
           { shading: { type: ShadingType.SOLID, color: "FAFAFA" } }),
      cell(para(text(""))), cell(para(text(""))),
    ]}));

    if (bs.nonCurrentAssets) {
      bsRows.push(new TableRow({ children: [
        labelCell("Non-Current Assets", { textOpts: { bold: true } }),
        cell(para(text(""))), cell(para(text(""))),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Property, Plant and Equipment"),
        numCell(bs.nonCurrentAssets.propertyPlantEquipment?.[0]),
        numCell(bs.nonCurrentAssets.propertyPlantEquipment?.[1]),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Intangible Assets"),
        numCell(bs.nonCurrentAssets.intangibleAssets?.[0]),
        numCell(bs.nonCurrentAssets.intangibleAssets?.[1]),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Investments"),
        numCell(bs.nonCurrentAssets.investments?.[0]),
        numCell(bs.nonCurrentAssets.investments?.[1]),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Other Non-Current Assets"),
        numCell(bs.nonCurrentAssets.otherNonCurrentAssets?.[0]),
        numCell(bs.nonCurrentAssets.otherNonCurrentAssets?.[1]),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Total Non-Current Assets", { textOpts: { bold: true } }),
        numCell(bs.nonCurrentAssets.totalNonCurrentAssets?.[0], { textOpts: { bold: true } }),
        numCell(bs.nonCurrentAssets.totalNonCurrentAssets?.[1], { textOpts: { bold: true } }),
      ]}));
    }

    if (bs.currentAssets) {
      bsRows.push(new TableRow({ children: [
        labelCell("Current Assets", { textOpts: { bold: true } }),
        cell(para(text(""))), cell(para(text(""))),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Inventories"),
        numCell(bs.currentAssets.inventories?.[0]),
        numCell(bs.currentAssets.inventories?.[1]),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Trade Receivables"),
        numCell(bs.currentAssets.tradeReceivables?.[0]),
        numCell(bs.currentAssets.tradeReceivables?.[1]),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Cash and Cash Equivalents"),
        numCell(bs.currentAssets.cashAndEquivalents?.[0]),
        numCell(bs.currentAssets.cashAndEquivalents?.[1]),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Short-term Loans and Advances"),
        numCell(bs.currentAssets.shortTermLoansAndAdvances?.[0]),
        numCell(bs.currentAssets.shortTermLoansAndAdvances?.[1]),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Other Current Assets"),
        numCell(bs.currentAssets.otherCurrentAssets?.[0]),
        numCell(bs.currentAssets.otherCurrentAssets?.[1]),
      ]}));
      bsRows.push(new TableRow({ children: [
        labelCell("    Total Current Assets", { textOpts: { bold: true } }),
        numCell(bs.currentAssets.totalCurrentAssets?.[0], { textOpts: { bold: true } }),
        numCell(bs.currentAssets.totalCurrentAssets?.[1], { textOpts: { bold: true } }),
      ]}));
    }

    bsRows.push(new TableRow({ children: [
      labelCell("TOTAL ASSETS", { textOpts: { bold: true } }),
      numCell(bs.totalAssets?.[0], { textOpts: { bold: true }, shading: { type: ShadingType.SOLID, color: "F5F5F5" } }),
      numCell(bs.totalAssets?.[1], { textOpts: { bold: true }, shading: { type: ShadingType.SOLID, color: "F5F5F5" } }),
    ]}));

    const bsTable = new Table({
      rows: bsRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: [4500, 1500, 1500]
    });
    allSections.push(bsTable);
  }

  return { docx, data, originalFileName, allSections, ci, pl, cf, ratios, notes };
}
async function finalizePrivateCompanyDoc(partial) {
  const { docx, data, originalFileName, allSections, ci, pl, cf, ratios, notes } = partial;
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    BorderStyle, AlignmentType, WidthType, PageNumber, Header, Footer, ShadingType
  } = docx;

  const BLACK = "000000";

  const cellBorder = {
    top: { style: BorderStyle.SINGLE, size: 4, color: BLACK },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: BLACK },
    left: { style: BorderStyle.SINGLE, size: 4, color: BLACK },
    right: { style: BorderStyle.SINGLE, size: 4, color: BLACK },
  };

  const text = (str, opts = {}) => new TextRun({
    text: String(str || ""),
    font: opts.font || "Arial",
    size: opts.size || 18,
    bold: opts.bold || false,
    italics: opts.italics || false,
    color: opts.color || BLACK,
    ...opts
  });

  const para = (children, opts = {}) => new Paragraph({
    children: Array.isArray(children) ? children : [children],
    alignment: opts.align || AlignmentType.LEFT,
    spacing: opts.spacing || { before: 100, after: 100 },
    ...opts
  });

  const cell = (children, opts = {}) => new TableCell({
    children: Array.isArray(children) ? children : [children],
    borders: cellBorder,
    width: opts.width,
    shading: opts.shading,
    verticalAlign: "center",
    ...opts
  });

  const numCell = (value, opts = {}) => cell(
    para(text(value != null && value !== "NA" ? formatNumber(value) : "—", { font: "Arial", size: 18, ...(opts.textOpts || {}) }), { align: AlignmentType.RIGHT }),
    opts
  );

  const labelCell = (label, opts = {}) => cell(
    para(text(label, { font: "Arial", size: 18, ...(opts.textOpts || {}) }), { align: AlignmentType.LEFT }),
    opts
  );

  const sectionHeader = (number, title) => para(
    [text(`[${number}] ${title}`, { font: "Times New Roman", size: 24, bold: true })],
    { align: AlignmentType.CENTER, spacing: { before: 400, after: 200 } }
  );

  const disclaimer = (curr) => para(
    [text(`Unless otherwise specified, all monetary values are in ${curr || "Lakhs"} of INR`, {
      font: "Times New Roman", size: 18, italics: true
    })],
    { align: AlignmentType.RIGHT, spacing: { before: 100, after: 200 } }
  );

  function formatNumber(val) {
    if (val == null || val === "NA" || val === "") return "—";
    if (typeof val === 'string' && isNaN(parseFloat(val))) return val;
    const num = parseFloat(val);
    if (isNaN(num)) return val;
    return num.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  if (pl.available) {
    allSections.push(sectionHeader("400300", "Profit and Loss Statement"));
    allSections.push(disclaimer(ci.rounding));

    const periods = pl.periods || ["Current Year", "Previous Year"];

    const plRows = [
      new TableRow({
        tableHeader: true,
        children: [
          cell(para(text("Particulars", { font: "Arial", size: 18, bold: true })),
               { shading: { type: ShadingType.SOLID, color: "F0F0F0" } }),
          cell(para(text(periods[0] || "", { font: "Arial", size: 18, bold: true }), { align: AlignmentType.CENTER }),
               { shading: { type: ShadingType.SOLID, color: "F0F0F0" } }),
          cell(para(text(periods[1] || "", { font: "Arial", size: 18, bold: true }), { align: AlignmentType.CENTER }),
               { shading: { type: ShadingType.SOLID, color: "F0F0F0" } }),
        ]
      }),
    ];

    if (pl.revenue) {
      plRows.push(new TableRow({ children: [
        labelCell("Revenue", { textOpts: { bold: true } }),
        cell(para(text(""))), cell(para(text(""))),
      ]}));
      plRows.push(new TableRow({ children: [
        labelCell("    Revenue from Operations"),
        numCell(pl.revenue.revenueFromOperations?.[0]),
        numCell(pl.revenue.revenueFromOperations?.[1]),
      ]}));
      plRows.push(new TableRow({ children: [
        labelCell("    Other Income"),
        numCell(pl.revenue.otherIncome?.[0]),
        numCell(pl.revenue.otherIncome?.[1]),
      ]}));
      plRows.push(new TableRow({ children: [
        labelCell("    Total Revenue", { textOpts: { bold: true } }),
        numCell(pl.revenue.totalRevenue?.[0], { textOpts: { bold: true } }),
        numCell(pl.revenue.totalRevenue?.[1], { textOpts: { bold: true } }),
      ]}));
    }

    if (pl.expenses) {
      plRows.push(new TableRow({ children: [
        labelCell("Expenses", { textOpts: { bold: true } }),
        cell(para(text(""))), cell(para(text(""))),
      ]}));
      plRows.push(new TableRow({ children: [
        labelCell("    Cost of Materials Consumed"),
        numCell(pl.expenses.costOfMaterials?.[0]),
        numCell(pl.expenses.costOfMaterials?.[1]),
      ]}));
      plRows.push(new TableRow({ children: [
        labelCell("    Purchase of Stock-in-Trade"),
        numCell(pl.expenses.purchaseOfStockInTrade?.[0]),
        numCell(pl.expenses.purchaseOfStockInTrade?.[1]),
      ]}));
      plRows.push(new TableRow({ children: [
        labelCell("    Changes in Inventories"),
        numCell(pl.expenses.changesInInventories?.[0]),
        numCell(pl.expenses.changesInInventories?.[1]),
      ]}));
      plRows.push(new TableRow({ children: [
        labelCell("    Employee Benefits Expense"),
        numCell(pl.expenses.employeeBenefits?.[0]),
        numCell(pl.expenses.employeeBenefits?.[1]),
      ]}));
      plRows.push(new TableRow({ children: [
        labelCell("    Finance Costs"),
        numCell(pl.expenses.financeCosts?.[0]),
        numCell(pl.expenses.financeCosts?.[1]),
      ]}));
      plRows.push(new TableRow({ children: [
        labelCell("    Depreciation and Amortization"),
        numCell(pl.expenses.depreciation?.[0]),
        numCell(pl.expenses.depreciation?.[1]),
      ]}));
      plRows.push(new TableRow({ children: [
        labelCell("    Other Expenses"),
        numCell(pl.expenses.otherExpenses?.[0]),
        numCell(pl.expenses.otherExpenses?.[1]),
      ]}));
      plRows.push(new TableRow({ children: [
        labelCell("    Total Expenses", { textOpts: { bold: true } }),
        numCell(pl.expenses.totalExpenses?.[0], { textOpts: { bold: true } }),
        numCell(pl.expenses.totalExpenses?.[1], { textOpts: { bold: true } }),
      ]}));
    }

    plRows.push(new TableRow({ children: [
      labelCell("Profit Before Tax", { textOpts: { bold: true } }),
      numCell(pl.profitBeforeTax?.[0], { textOpts: { bold: true }, shading: { type: ShadingType.SOLID, color: "FAFAFA" } }),
      numCell(pl.profitBeforeTax?.[1], { textOpts: { bold: true }, shading: { type: ShadingType.SOLID, color: "FAFAFA" } }),
    ]}));

    plRows.push(new TableRow({ children: [
      labelCell("Tax Expense"),
      numCell(pl.taxExpense?.[0]),
      numCell(pl.taxExpense?.[1]),
    ]}));

    plRows.push(new TableRow({ children: [
      labelCell("Profit for the Period", { textOpts: { bold: true } }),
      numCell(pl.profitForPeriod?.[0], { textOpts: { bold: true }, shading: { type: ShadingType.SOLID, color: "F5F5F5" } }),
      numCell(pl.profitForPeriod?.[1], { textOpts: { bold: true }, shading: { type: ShadingType.SOLID, color: "F5F5F5" } }),
    ]}));

    if (pl.earningsPerShare) {
      plRows.push(new TableRow({ children: [
        labelCell("Earnings Per Share", { textOpts: { bold: true } }),
        cell(para(text(""))), cell(para(text(""))),
      ]}));
      plRows.push(new TableRow({ children: [
        labelCell("    Basic"),
        numCell(pl.earningsPerShare.basic?.[0]),
        numCell(pl.earningsPerShare.basic?.[1]),
      ]}));
      plRows.push(new TableRow({ children: [
        labelCell("    Diluted"),
        numCell(pl.earningsPerShare.diluted?.[0]),
        numCell(pl.earningsPerShare.diluted?.[1]),
      ]}));
    }

    const plTable = new Table({
      rows: plRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: [4500, 1500, 1500]
    });
    allSections.push(plTable);
  }

  if (cf.available) {
    allSections.push(sectionHeader("400400", "Cash Flow Statement"));
    allSections.push(disclaimer(ci.rounding));

    const periods = cf.periods || ["Current Year", "Previous Year"];

    const cfRows = [
      new TableRow({
        tableHeader: true,
        children: [
          cell(para(text("Particulars", { font: "Arial", size: 18, bold: true })),
               { shading: { type: ShadingType.SOLID, color: "F0F0F0" } }),
          cell(para(text(periods[0] || "", { font: "Arial", size: 18, bold: true }), { align: AlignmentType.CENTER }),
               { shading: { type: ShadingType.SOLID, color: "F0F0F0" } }),
          cell(para(text(periods[1] || "", { font: "Arial", size: 18, bold: true }), { align: AlignmentType.CENTER }),
               { shading: { type: ShadingType.SOLID, color: "F0F0F0" } }),
        ]
      }),
    ];

    if (cf.operating) {
      cfRows.push(new TableRow({ children: [
        labelCell("A. Cash Flow from Operating Activities", { textOpts: { bold: true } }),
        cell(para(text(""))), cell(para(text(""))),
      ]}));
      cfRows.push(new TableRow({ children: [
        labelCell("    Profit Before Tax"),
        numCell(cf.operating.profitBeforeTax?.[0]),
        numCell(cf.operating.profitBeforeTax?.[1]),
      ]}));
      cfRows.push(new TableRow({ children: [
        labelCell("    Adjustments for Non-Cash Items"),
        numCell(cf.operating.adjustments?.[0]),
        numCell(cf.operating.adjustments?.[1]),
      ]}));
      cfRows.push(new TableRow({ children: [
        labelCell("    Working Capital Changes"),
        numCell(cf.operating.workingCapitalChanges?.[0]),
        numCell(cf.operating.workingCapitalChanges?.[1]),
      ]}));
      cfRows.push(new TableRow({ children: [
        labelCell("    Taxes Paid"),
        numCell(cf.operating.taxesPaid?.[0]),
        numCell(cf.operating.taxesPaid?.[1]),
      ]}));
      cfRows.push(new TableRow({ children: [
        labelCell("    Net Cash from Operating Activities", { textOpts: { bold: true } }),
        numCell(cf.operating.netCashFromOperating?.[0], { textOpts: { bold: true } }),
        numCell(cf.operating.netCashFromOperating?.[1], { textOpts: { bold: true } }),
      ]}));
    }

    if (cf.investing) {
      cfRows.push(new TableRow({ children: [
        labelCell("B. Cash Flow from Investing Activities", { textOpts: { bold: true } }),
        cell(para(text(""))), cell(para(text(""))),
      ]}));
      cfRows.push(new TableRow({ children: [
        labelCell("    Purchase of Fixed Assets"),
        numCell(cf.investing.purchaseOfFixedAssets?.[0]),
        numCell(cf.investing.purchaseOfFixedAssets?.[1]),
      ]}));
      cfRows.push(new TableRow({ children: [
        labelCell("    Sale of Fixed Assets"),
        numCell(cf.investing.saleOfFixedAssets?.[0]),
        numCell(cf.investing.saleOfFixedAssets?.[1]),
      ]}));
      cfRows.push(new TableRow({ children: [
        labelCell("    Investments Made"),
        numCell(cf.investing.investmentsMade?.[0]),
        numCell(cf.investing.investmentsMade?.[1]),
      ]}));
      cfRows.push(new TableRow({ children: [
        labelCell("    Interest Received"),
        numCell(cf.investing.interestReceived?.[0]),
        numCell(cf.investing.interestReceived?.[1]),
      ]}));
      cfRows.push(new TableRow({ children: [
        labelCell("    Net Cash from Investing Activities", { textOpts: { bold: true } }),
        numCell(cf.investing.netCashFromInvesting?.[0], { textOpts: { bold: true } }),
        numCell(cf.investing.netCashFromInvesting?.[1], { textOpts: { bold: true } }),
      ]}));
    }

    if (cf.financing) {
      cfRows.push(new TableRow({ children: [
        labelCell("C. Cash Flow from Financing Activities", { textOpts: { bold: true } }),
        cell(para(text(""))), cell(para(text(""))),
      ]}));
      cfRows.push(new TableRow({ children: [
        labelCell("    Proceeds from Borrowings"),
        numCell(cf.financing.proceedsFromBorrowings?.[0]),
        numCell(cf.financing.proceedsFromBorrowings?.[1]),
      ]}));
      cfRows.push(new TableRow({ children: [
        labelCell("    Repayment of Borrowings"),
        numCell(cf.financing.repaymentOfBorrowings?.[0]),
        numCell(cf.financing.repaymentOfBorrowings?.[1]),
      ]}));
      cfRows.push(new TableRow({ children: [
        labelCell("    Interest Paid"),
        numCell(cf.financing.interestPaid?.[0]),
        numCell(cf.financing.interestPaid?.[1]),
      ]}));
      cfRows.push(new TableRow({ children: [
        labelCell("    Dividend Paid"),
        numCell(cf.financing.dividendPaid?.[0]),
        numCell(cf.financing.dividendPaid?.[1]),
      ]}));
      cfRows.push(new TableRow({ children: [
        labelCell("    Net Cash from Financing Activities", { textOpts: { bold: true } }),
        numCell(cf.financing.netCashFromFinancing?.[0], { textOpts: { bold: true } }),
        numCell(cf.financing.netCashFromFinancing?.[1], { textOpts: { bold: true } }),
      ]}));
    }

    cfRows.push(new TableRow({ children: [
      labelCell("Net Change in Cash", { textOpts: { bold: true } }),
      numCell(cf.netChangeInCash?.[0], { textOpts: { bold: true } }),
      numCell(cf.netChangeInCash?.[1], { textOpts: { bold: true } }),
    ]}));
    cfRows.push(new TableRow({ children: [
      labelCell("Opening Cash Balance"),
      numCell(cf.openingCash?.[0]),
      numCell(cf.openingCash?.[1]),
    ]}));
    cfRows.push(new TableRow({ children: [
      labelCell("Closing Cash Balance", { textOpts: { bold: true } }),
      numCell(cf.closingCash?.[0], { textOpts: { bold: true }, shading: { type: ShadingType.SOLID, color: "F5F5F5" } }),
      numCell(cf.closingCash?.[1], { textOpts: { bold: true }, shading: { type: ShadingType.SOLID, color: "F5F5F5" } }),
    ]}));

    const cfTable = new Table({
      rows: cfRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: [4500, 1500, 1500]
    });
    allSections.push(cfTable);
  }

  if (ratios.calculated) {
    allSections.push(sectionHeader("400500", "Key Financial Ratios"));
    allSections.push(disclaimer(ci.rounding));

    const ratioRows = [
      new TableRow({
        tableHeader: true,
        children: [
          cell(para(text("Ratio Category", { font: "Arial", size: 18, bold: true })),
               { shading: { type: ShadingType.SOLID, color: "F0F0F0" } }),
          cell(para(text("Ratio Name", { font: "Arial", size: 18, bold: true })),
               { shading: { type: ShadingType.SOLID, color: "F0F0F0" } }),
          cell(para(text("Value", { font: "Arial", size: 18, bold: true }), { align: AlignmentType.CENTER }),
               { shading: { type: ShadingType.SOLID, color: "F0F0F0" } }),
        ]
      }),
    ];

    if (ratios.profitability) {
      const r = ratios.profitability;
      ratioRows.push(new TableRow({ children: [
        cell(para(text("Profitability", { font: "Arial", size: 18, bold: true }))),
        labelCell("Gross Margin"),
        cell(para(text(r.grossMargin || "—", { font: "Arial", size: 18 }), { align: AlignmentType.CENTER })),
      ]}));
      ratioRows.push(new TableRow({ children: [
        cell(para(text(""))),
        labelCell("Operating Margin"),
        cell(para(text(r.operatingMargin || "—", { font: "Arial", size: 18 }), { align: AlignmentType.CENTER })),
      ]}));
      ratioRows.push(new TableRow({ children: [
        cell(para(text(""))),
        labelCell("Net Margin"),
        cell(para(text(r.netMargin || "—", { font: "Arial", size: 18 }), { align: AlignmentType.CENTER })),
      ]}));
      ratioRows.push(new TableRow({ children: [
        cell(para(text(""))),
        labelCell("Return on Equity (ROE)"),
        cell(para(text(r.returnOnEquity || "—", { font: "Arial", size: 18 }), { align: AlignmentType.CENTER })),
      ]}));
      ratioRows.push(new TableRow({ children: [
        cell(para(text(""))),
        labelCell("Return on Assets (ROA)"),
        cell(para(text(r.returnOnAssets || "—", { font: "Arial", size: 18 }), { align: AlignmentType.CENTER })),
      ]}));
    }

    if (ratios.liquidity) {
      const r = ratios.liquidity;
      ratioRows.push(new TableRow({ children: [
        cell(para(text("Liquidity", { font: "Arial", size: 18, bold: true }))),
        labelCell("Current Ratio"),
        cell(para(text(r.currentRatio || "—", { font: "Arial", size: 18 }), { align: AlignmentType.CENTER })),
      ]}));
      ratioRows.push(new TableRow({ children: [
        cell(para(text(""))),
        labelCell("Quick Ratio"),
        cell(para(text(r.quickRatio || "—", { font: "Arial", size: 18 }), { align: AlignmentType.CENTER })),
      ]}));
      ratioRows.push(new TableRow({ children: [
        cell(para(text(""))),
        labelCell("Cash Ratio"),
        cell(para(text(r.cashRatio || "—", { font: "Arial", size: 18 }), { align: AlignmentType.CENTER })),
      ]}));
    }

    if (ratios.leverage) {
      const r = ratios.leverage;
      ratioRows.push(new TableRow({ children: [
        cell(para(text("Leverage", { font: "Arial", size: 18, bold: true }))),
        labelCell("Debt to Equity"),
        cell(para(text(r.debtToEquity || "—", { font: "Arial", size: 18 }), { align: AlignmentType.CENTER })),
      ]}));
      ratioRows.push(new TableRow({ children: [
        cell(para(text(""))),
        labelCell("Interest Coverage"),
        cell(para(text(r.interestCoverage || "—", { font: "Arial", size: 18 }), { align: AlignmentType.CENTER })),
      ]}));
      ratioRows.push(new TableRow({ children: [
        cell(para(text(""))),
        labelCell("Debt to Assets"),
        cell(para(text(r.debtToAssets || "—", { font: "Arial", size: 18 }), { align: AlignmentType.CENTER })),
      ]}));
    }

    if (ratios.efficiency) {
      const r = ratios.efficiency;
      ratioRows.push(new TableRow({ children: [
        cell(para(text("Efficiency", { font: "Arial", size: 18, bold: true }))),
        labelCell("Asset Turnover"),
        cell(para(text(r.assetTurnover || "—", { font: "Arial", size: 18 }), { align: AlignmentType.CENTER })),
      ]}));
      ratioRows.push(new TableRow({ children: [
        cell(para(text(""))),
        labelCell("Inventory Turnover"),
        cell(para(text(r.inventoryTurnover || "—", { font: "Arial", size: 18 }), { align: AlignmentType.CENTER })),
      ]}));
      ratioRows.push(new TableRow({ children: [
        cell(para(text(""))),
        labelCell("Receivables Days"),
        cell(para(text(r.receivablesDays || "—", { font: "Arial", size: 18 }), { align: AlignmentType.CENTER })),
      ]}));
    }

    const ratiosTable = new Table({
      rows: ratioRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: [2500, 3500, 1500]
    });
    allSections.push(ratiosTable);
  }

  if (notes.length > 0) {
    allSections.push(sectionHeader("400600", "Notes to Financial Statements"));
    allSections.push(disclaimer(ci.rounding));

    notes.forEach((note) => {
      allSections.push(para(
        [text(`Note ${note.noteNumber || ""}: ${note.title || ""}`, {
          font: "Arial", size: 20, bold: true
        })],
        { spacing: { before: 300, after: 100 } }
      ));
      if (note.content) {
        allSections.push(para(
          [text(note.content, { font: "Arial", size: 18 })],
          { spacing: { before: 100, after: 200 } }
        ));
      }
    });
  }

  const doc = new Document({
    creator: "Pallav Shah",
    title: `${ci.name || "Private Company"} - Financial Statements`,
    description: "Generated by FinSight AI",
    sections: [{
      properties: {
        page: {
          margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 }
        }
      },
      headers: {
        default: new Header({
          children: [
            para(
              [text(`${ci.name || "Private Company"} ${ci.reportingPeriod ? `Standalone Financial Statements for period ${ci.reportingPeriod}` : ""}`, {
                font: "Arial", size: 14, italics: true, color: "666666"
              })],
              { spacing: { before: 0, after: 0 } }
            )
          ]
        })
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "666666" })
              ]
            })
          ]
        })
      },
      children: allSections
    }]
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = (ci.name || "Private_Company").replace(/[^a-zA-Z0-9]/g, '_');
  a.download = `${safeName}_Organized_Financials.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function processPrivateCompanyDoc(file, onProgress) {
  try {
    onProgress?.("Reading your document...");
    const extractedText = await extractWordContent(file);

    if (!extractedText || extractedText.trim().length < 100) {
      throw new Error("Document appears to be empty or unreadable. Please check the file.");
    }

    onProgress?.("AI is organizing the data...");
    const systemPrompt = buildPrivateCompanyPrompt();
    const aiResponse = await callClaude({
      system: systemPrompt,
      userMsg: `Here is the raw text from a private company financial document. Please extract and organize the data:\n\n${extractedText}`,
      maxTokens: 8000
    });

    onProgress?.("Structuring the output...");
    let cleanResponse = aiResponse.trim();
    if (cleanResponse.startsWith('```json')) {
      cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/```\s*$/, '');
    } else if (cleanResponse.startsWith('```')) {
      cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/```\s*$/, '');
    }

    let data;
    try {
      data = JSON.parse(cleanResponse);
    } catch (e) {
      throw new Error("AI response could not be parsed. Please try with a clearer document.");
    }

    onProgress?.("Generating your professional Word document...");
    const partial = await generatePrivateCompanyDoc(data, file.name);
    await finalizePrivateCompanyDoc(partial);

    return { success: true, data, fileName: file.name };
  } catch (error) {
    console.error("Private company doc processing error:", error);
    throw error;
  }
}

function PrivateDocUploadZone({ onProcess, isProcessing, progress, error }) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    handleFile(files[0]);
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    handleFile(files[0]);
  };

  const handleFile = (file) => {
    if (!file) return;
    if (!file.name.match(/\.(docx?|doc)$/i)) {
      alert("Please upload a Word document (.docx or .doc)");
      return;
    }
    onProcess(file);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div style={{ width: "100%", maxWidth: 720, margin: "16px auto 0" }}>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={!isProcessing ? handleClick : undefined}
        style={{
          padding: "24px 20px",
          background: isDragging ? C.brownLight : (isProcessing ? "#F5F5F5" : "#FAFAFA"),
          border: `2px dashed ${isDragging ? C.brown : C.border}`,
          borderRadius: 12,
          cursor: isProcessing ? "wait" : "pointer",
          transition: "all 0.2s",
          textAlign: "center",
          opacity: isProcessing ? 0.7 : 1,
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".doc,.docx"
          onChange={handleFileSelect}
          style={{ display: "none" }}
          disabled={isProcessing}
        />

        {!isProcessing ? (
          <>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
            <div style={{
              fontSize: 14,
              fontWeight: 600,
              color: C.textPrimary,
              marginBottom: 4
            }}>
              Upload Private Company Financials
            </div>
            <div style={{ fontSize: 12, color: C.textSec, marginBottom: 8 }}>
              Drag & drop your Word document here, or click to browse
            </div>
            <div style={{
              fontSize: 11,
              color: C.textMuted,
              fontStyle: "italic"
            }}>
              Supports .docx and .doc files • Get organized output in seconds
            </div>
          </>
        ) : (
          <>
            <div style={{
              fontSize: 22,
              marginBottom: 12,
              animation: "spin 2s linear infinite"
            }}>⚙️</div>
            <div style={{
              fontSize: 14,
              fontWeight: 600,
              color: C.brown,
              marginBottom: 4
            }}>
              {progress || "Processing..."}
            </div>
            <div style={{ fontSize: 11, color: C.textMuted }}>
              This usually takes 20-40 seconds
            </div>
          </>
        )}
      </div>

      {error && (
        <div style={{
          marginTop: 12,
          padding: "10px 14px",
          background: C.redBg,
          border: `1px solid ${C.red}`,
          borderRadius: 8,
          fontSize: 12,
          color: C.red,
        }}>
          ⚠ {error}
        </div>
      )}
    </div>
  );
}

function Byline({ size = "small" }) {
  const sizes = {
    tiny:   { font: 9,  weight: 500 },
    small:  { font: 11, weight: 500 },
    medium: { font: 12, weight: 600 },
    large:  { font: 14, weight: 600 },
  };
  const s = sizes[size] || sizes.small;
  return (
    <div style={{
      fontSize: s.font,
      fontWeight: s.weight,
      color: C.textMuted,
      letterSpacing: "0.02em",
      fontFamily: "ui-sans-serif,system-ui,-apple-system,sans-serif",
    }}>
      by Pallav Shah
    </div>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState("signin");
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: C.bgPage, padding: 20, fontFamily: "ui-sans-serif,system-ui,sans-serif"
    }}>
      <div style={{ width: "100%", maxWidth: 480, textAlign: "center" }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 36, fontWeight: 700, color: C.accent, marginBottom: 6 }}>
            FinSight AI
          </div>
          <Byline size="medium" />
          <div style={{ fontSize: 14, color: C.textSec, marginTop: 12 }}>
            Financial intelligence, one company at a time
          </div>
        </div>
        <div style={{
          background: C.bgCard, borderRadius: 16, padding: 24,
          boxShadow: C.shadowMd, border: `1px solid ${C.border}`
        }}>
          {mode === "signin" ? (
            <SignIn afterSignInUrl="/" signUpUrl="#" />
          ) : (
            <SignUp afterSignUpUrl="/" signInUrl="#" />
          )}
          <div style={{ marginTop: 16, fontSize: 13, color: C.textSec }}>
            {mode === "signin" ? (
              <>New here? <button onClick={() => setMode("signup")} style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontWeight: 600 }}>Sign up</button></>
            ) : (
              <>Already have an account? <button onClick={() => setMode("signin")} style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontWeight: 600 }}>Sign in</button></>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FinSightApp() {
  const { user } = useUser();
  const [view, setView] = useState("landing");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState(DEFAULT_PERIOD);
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");

  const [privateDocLoading, setPrivateDocLoading] = useState(false);
  const [privateDocProgress, setPrivateDocProgress] = useState("");
  const [privateDocError, setPrivateDocError] = useState("");

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setLoading(true);
    setSearchError("");
    try {
      const period = PERIODS.find(p => p.id === selectedPeriod) || PERIODS[2];
      const sysPrompt = `You are FinSight AI. Generate a brief financial summary for: ${q}. Period: ${period.label}.`;
      const result = await callClaude({
        system: sysPrompt,
        userMsg: `Provide a financial overview of ${q} for ${period.label}.`,
        maxTokens: 2000
      });
      setReport({ companyName: q, content: result, period: period.label });
      setView("dashboard");
    } catch (e) {
      setSearchError(e.message || "Search failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handlePrivateDocProcess = async (file) => {
    setPrivateDocLoading(true);
    setPrivateDocError("");
    setPrivateDocProgress("");
    try {
      await processPrivateCompanyDoc(file, (msg) => setPrivateDocProgress(msg));
      setPrivateDocProgress("Done! Your document has been downloaded.");
      setTimeout(() => {
        setPrivateDocLoading(false);
        setPrivateDocProgress("");
      }, 2000);
    } catch (e) {
      setPrivateDocError(e.message || "Failed to process document. Please try again.");
      setPrivateDocLoading(false);
      setPrivateDocProgress("");
    }
  };

  if (view === "landing") {
    return (
      <div style={{
        minHeight: "100vh", background: C.bgPage,
        fontFamily: "ui-sans-serif,system-ui,-apple-system,sans-serif",
        display: "flex", flexDirection: "column"
      }}>
        <div style={{
          padding: "16px 24px", display: "flex", justifyContent: "space-between",
          alignItems: "center", borderBottom: `1px solid ${C.border}`, background: C.bgCard
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.accent }}>FinSight AI</div>
            <Byline size="tiny" />
          </div>
          <UserButton afterSignOutUrl="/" />
        </div>

        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", padding: "40px 20px"
        }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <h1 style={{
              fontSize: 42, fontWeight: 800, color: C.textPrimary,
              margin: "0 0 12px 0", letterSpacing: "-0.02em"
            }}>
              FinSight AI
            </h1>
            <Byline size="medium" />
            <p style={{ fontSize: 16, color: C.textSec, marginTop: 12, maxWidth: 600 }}>
              AI-powered financial intelligence. Public companies + Private company document organizer.
            </p>
          </div>

          <div style={{ width: "100%", maxWidth: 720 }}>
            <div style={{
              display: "flex", gap: 8, padding: 6,
              background: C.bgCard, border: `1px solid ${C.border}`,
              borderRadius: 12, boxShadow: C.shadow
            }}>
              <button
                onClick={() => setShowPeriodDropdown(v => !v)}
                style={{
                  padding: "10px 14px", border: `1px solid ${C.border}`,
                  borderRadius: 8, background: C.bgSidebar, fontSize: 13,
                  fontWeight: 600, color: C.textPrimary, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 6
                }}
              >
                {PERIODS.find(p => p.id === selectedPeriod)?.short || "Period"}
                <span style={{ fontSize: 10 }}>▼</span>
              </button>
              <input
                type="text"
                placeholder="Search any public company (e.g., Reliance, Apple, TCS)..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                style={{
                  flex: 1, padding: "10px 14px", border: "none",
                  background: "transparent", fontSize: 14, color: C.textPrimary,
                  outline: "none"
                }}
              />
              <button
                onClick={handleSearch}
                disabled={loading || !searchQuery.trim()}
                style={{
                  padding: "10px 20px", border: "none", borderRadius: 8,
                  background: C.accent, color: "#fff", fontSize: 14, fontWeight: 600,
                  cursor: loading ? "wait" : "pointer", opacity: !searchQuery.trim() ? 0.5 : 1
                }}
              >
                {loading ? "..." : "Analyze"}
              </button>
            </div>
            {showPeriodDropdown && (
              <div style={{
                marginTop: 4, padding: 8, background: C.bgCard,
                border: `1px solid ${C.border}`, borderRadius: 8,
                boxShadow: C.shadowMd
              }}>
                {PERIODS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { setSelectedPeriod(p.id); setShowPeriodDropdown(false); }}
                    style={{
                      width: "100%", padding: "8px 12px", border: "none",
                      background: selectedPeriod === p.id ? C.accentLight : "transparent",
                      textAlign: "left", borderRadius: 6, cursor: "pointer",
                      display: "flex", justifyContent: "space-between", marginBottom: 2
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{p.label}</span>
                    <span style={{ fontSize: 12, color: C.textMuted }}>{p.desc}</span>
                  </button>
                ))}
              </div>
            )}
            {searchError && (
              <div style={{
                marginTop: 8, padding: "8px 12px", background: C.redBg,
                border: `1px solid ${C.red}`, borderRadius: 8, fontSize: 12, color: C.red
              }}>
                {searchError}
              </div>
            )}
          </div>

          <div style={{
            width: "100%", maxWidth: 720, margin: "24px auto 16px",
            display: "flex", alignItems: "center", gap: 12
          }}>
            <div style={{ flex: 1, height: 1, background: C.border }}></div>
            <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, letterSpacing: "0.05em" }}>
              OR ORGANIZE PRIVATE COMPANY DOCS
            </div>
            <div style={{ flex: 1, height: 1, background: C.border }}></div>
          </div>

          <PrivateDocUploadZone
            onProcess={handlePrivateDocProcess}
            isProcessing={privateDocLoading}
            progress={privateDocProgress}
            error={privateDocError}
          />

          <div style={{
            marginTop: 20,
            fontSize: 11,
            color: C.textMuted,
            textAlign: "center",
            maxWidth: 600
          }}>
            <strong>How it works:</strong> Upload a messy private company Word doc (balance sheet, P&L, cash flow, etc.).
            AI organizes the data into a professional, statutory-style Word document.
            <em> Your data, your numbers — just organized.</em>
          </div>
        </div>

        <div style={{
          padding: "16px 24px", borderTop: `1px solid ${C.border}`,
          background: C.bgCard, fontSize: 11, color: C.textMuted,
          textAlign: "center"
        }}>
          FinSight AI • by Pallav Shah • finsightai.org
        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh", background: C.bgPage,
      fontFamily: "ui-sans-serif,system-ui,-apple-system,sans-serif"
    }}>
      <div style={{
        padding: "16px 24px", display: "flex", justifyContent: "space-between",
        alignItems: "center", borderBottom: `1px solid ${C.border}`, background: C.bgCard
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.accent }}>FinSight AI</div>
          <Byline size="tiny" />
        </div>
        <button
          onClick={() => { setView("landing"); setReport(null); }}
          style={{
            padding: "8px 16px", border: `1px solid ${C.border}`, borderRadius: 8,
            background: C.bgCard, fontSize: 13, fontWeight: 600, cursor: "pointer"
          }}
        >
          ← New Search
        </button>
      </div>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: C.textPrimary }}>
          {report?.companyName || "Analysis"}
        </h1>
        <div style={{ fontSize: 14, color: C.textSec, marginTop: 4 }}>
          Period: {report?.period}
        </div>
        <div style={{
          marginTop: 24, padding: 24, background: C.bgCard,
          borderRadius: 12, border: `1px solid ${C.border}`,
          fontSize: 14, lineHeight: 1.6, color: C.textPrimary, whiteSpace: "pre-wrap"
        }}>
          {report?.content}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  if (!CLERK_PUB_KEY) {
    return (
      <div style={{ padding: 40, textAlign: "center", fontFamily: "system-ui" }}>
        <h2>Clerk publishable key missing</h2>
        <p>Set VITE_CLERK_PUBLISHABLE_KEY in your environment.</p>
      </div>
    );
  }
  return (
    <ClerkProvider publishableKey={CLERK_PUB_KEY}>
      <SignedIn>
        <FinSightApp />
      </SignedIn>
      <SignedOut>
        <AuthScreen />
      </SignedOut>
    </ClerkProvider>
  );
}
