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
const AUTHOR_NAME = "Aashni Shah and Hitansh Jhaveri";

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
  return text.replace(/<cite[^>]*>/gi, '').replace(/<\/cite>/gi, '').replace(/\s+/g, ' ').trim();
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

async function loadHtml2Canvas() {
  if (window.html2canvas) return window.html2canvas;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    script.onload = () => resolve(window.html2canvas);
    script.onerror = () => reject(new Error('Failed to load html2canvas'));
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

function chunkText(text, maxCharsPerChunk = 25000) {
  const chunks = [];
  const paragraphs = text.split(/\n\s*\n/);
  let currentChunk = "";
  for (const para of paragraphs) {
    if ((currentChunk + para).length > maxCharsPerChunk && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = para + "\n\n";
    } else {
      currentChunk += para + "\n\n";
    }
  }
  if (currentChunk.trim().length > 0) chunks.push(currentChunk.trim());
  return chunks;
}

function buildChunkOrganizationPrompt(chunkIndex, totalChunks, companyContext) {
  return `You are a financial document organizer. You will receive a CHUNK (part ${chunkIndex} of ${totalChunks}) of a private company's financial document. Your task is to ORGANIZE this chunk's content while PRESERVING ALL DETAIL.

CRITICAL RULES:
1. PRESERVE ALL DATA - every number, every line item, every note, every disclosure.
2. DO NOT summarize. DO NOT compress. DO NOT skip information.
3. Identify which MAJOR SECTION this chunk belongs to (Balance Sheet, P&L, Cash Flow, Notes, etc.)
4. Format tables clearly with all rows and columns.
5. Keep all notes, disclosures, related party transactions, schedules - EVERYTHING.
6. NEVER invent or add information not in the chunk.

${companyContext ? `COMPANY CONTEXT (from earlier chunks): ${companyContext}` : ''}

OUTPUT FORMAT - Return organized content in this JSON structure:

{
  "chunkSummary": "1-line description",
  "sectionType": "company_info" | "balance_sheet" | "profit_loss" | "cash_flow" | "notes" | "schedules" | "auditor_report" | "other",
  "sectionNumber": "[400100]" | "[400200]" | "[400300]" | "[400400]" | "[400500]" | "[400600]" | etc,
  "sectionTitle": "Disclosure of general information about company" | "Balance Sheet" | "Profit and Loss Statement" | "Cash Flow Statement" | "Notes to Financial Statements" | etc,
  "sections": [
    {
      "type": "heading" | "subheading" | "paragraph" | "table" | "note" | "disclosure",
      "title": "section title if applicable",
      "content": "full text content preserved",
      "tableData": {
        "headers": ["col1", "col2", "col3"],
        "rows": [["val1", "val2", "val3"]]
      }
    }
  ],
  "companyInfoFound": {
    "name": "if mentioned",
    "cin": "if mentioned",
    "period": "if mentioned",
    "rounding": "Lakhs/Crores/Millions",
    "currency": "INR/USD/etc"
  }
}

Return ONLY clean JSON, no markdown wrappers, no explanations.`;
}

async function processChunkWithAI(chunkTextStr, chunkIndex, totalChunks, companyContext, onProgress) {
  onProgress?.(`Organizing section ${chunkIndex} of ${totalChunks}...`);
  const systemPrompt = buildChunkOrganizationPrompt(chunkIndex, totalChunks, companyContext);
  const aiResponse = await callClaude({
    system: systemPrompt,
    userMsg: `Here is chunk ${chunkIndex} of ${totalChunks}. Organize ALL content while preserving every detail:\n\n${chunkTextStr}`,
    maxTokens: 16000
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
      sectionType: "other",
      sectionNumber: "",
      sectionTitle: `Section ${chunkIndex}`,
      sections: [{ type: "paragraph", content: chunkTextStr.substring(0, 5000) }],
      companyInfoFound: {}
    };
  }
}

async function generateOrganizedWordDoc(chunkResults, companyInfo, originalFileName) {
  const docx = await loadDocx();
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    BorderStyle, AlignmentType, WidthType, PageNumber, Header, Footer, ShadingType
  } = docx;

  const BLACK = "000000";
  const BROWN = "8B4513";

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
  });

  const para = (children, opts = {}) => new Paragraph({
    children: Array.isArray(children) ? children : [children],
    alignment: opts.align || AlignmentType.LEFT,
    spacing: opts.spacing || { before: 100, after: 100 },
  });

  const cell = (children, opts = {}) => new TableCell({
    children: Array.isArray(children) ? children : [children],
    borders: cellBorder,
    width: opts.width,
    shading: opts.shading,
    verticalAlign: "center",
  });

  const sectionHeader = (number, title) => para(
    [text(`${number ? number + " " : ""}${title}`, {
      font: "Times New Roman", size: 26, bold: true, color: BROWN
    })],
    { align: AlignmentType.CENTER, spacing: { before: 400, after: 200 } }
  );

  const disclaimer = (curr) => para(
    [text(`Unless otherwise specified, all monetary values are in ${curr || "Lakhs"} of INR`, {
      font: "Times New Roman", size: 18, italics: true, color: BROWN
    })],
    { align: AlignmentType.RIGHT, spacing: { before: 100, after: 200 } }
  );

  const allSections = [];

  allSections.push(para(
    [text(companyInfo.name || "PRIVATE COMPANY", {
      font: "Times New Roman", size: 32, bold: true, color: BROWN
    })],
    { align: AlignmentType.CENTER, spacing: { before: 200, after: 100 } }
  ));

  allSections.push(para(
    [text(`Standalone Financial Statements for period ${companyInfo.period || ""}`, {
      font: "Times New Roman", size: 22, italics: true
    })],
    { align: AlignmentType.CENTER, spacing: { before: 100, after: 200 } }
  ));

  if (companyInfo.rounding || companyInfo.currency) {
    allSections.push(disclaimer(companyInfo.rounding));
  }

  allSections.push(para([text("", { size: 12 })], { spacing: { before: 200, after: 200 } }));

  let currentSection = "";
  for (const chunkResult of chunkResults) {
    if (!chunkResult.sections || chunkResult.sections.length === 0) continue;

    const newSection = chunkResult.sectionTitle || "";
    if (newSection && newSection !== currentSection) {
      allSections.push(sectionHeader(chunkResult.sectionNumber, newSection));
      allSections.push(disclaimer(companyInfo.rounding));
      currentSection = newSection;
    }

    for (const section of chunkResult.sections) {
      if (!section.content && !section.tableData) continue;

      if (section.type === "heading") {
        allSections.push(para(
          [text(section.title || section.content || "", {
            font: "Times New Roman", size: 24, bold: true, color: BROWN
          })],
          { align: AlignmentType.CENTER, spacing: { before: 300, after: 150 } }
        ));
      } else if (section.type === "subheading") {
        allSections.push(para(
          [text(section.title || section.content || "", {
            font: "Arial", size: 22, bold: true, color: BROWN
          })],
          { spacing: { before: 250, after: 120 } }
        ));
      } else if (section.type === "table" && section.tableData) {
        const td = section.tableData;
        if (td.headers && td.headers.length > 0) {
          if (section.title) {
            allSections.push(para(
              [text(section.title, { font: "Arial", size: 20, bold: true, color: BROWN })],
              { spacing: { before: 200, after: 100 } }
            ));
          }
          const tableRows = [];
          tableRows.push(new TableRow({
            tableHeader: true,
            children: td.headers.map(h =>
              cell(para(text(String(h || ""), { font: "Arial", size: 18, bold: true }),
                       { align: AlignmentType.CENTER }),
                   { shading: { type: ShadingType.SOLID, color: "F5EFE7" } })
            )
          }));
          if (td.rows && Array.isArray(td.rows)) {
            for (const row of td.rows) {
              if (!Array.isArray(row)) continue;
              tableRows.push(new TableRow({
                children: row.map((val) => {
                  const isNumeric = !isNaN(parseFloat(val)) && val !== "";
                  return cell(
                    para(text(String(val || ""), { font: "Arial", size: 18 }),
                         { align: isNumeric ? AlignmentType.RIGHT : AlignmentType.LEFT })
                  );
                })
              }));
            }
          }
          allSections.push(new Table({
            rows: tableRows,
            width: { size: 100, type: WidthType.PERCENTAGE }
          }));
          allSections.push(para([text("", { size: 12 })], { spacing: { before: 100, after: 100 } }));
        }
      } else if (section.type === "note" || section.type === "disclosure") {
        if (section.title) {
          allSections.push(para(
            [text(section.title, { font: "Arial", size: 20, bold: true, color: BROWN })],
            { spacing: { before: 250, after: 100 } }
          ));
        }
        if (section.content) {
          allSections.push(para(
            [text(section.content, { font: "Arial", size: 18, italics: section.type === "disclosure" })],
            { spacing: { before: 100, after: 200 } }
          ));
        }
      } else {
        if (section.title) {
          allSections.push(para(
            [text(section.title, { font: "Arial", size: 20, bold: true })],
            { spacing: { before: 200, after: 100 } }
          ));
        }
        if (section.content) {
          allSections.push(para(
            [text(section.content, { font: "Arial", size: 18 })],
            { spacing: { before: 100, after: 150 } }
          ));
        }
      }
    }
  }

  const doc = new Document({
    creator: AUTHOR_NAME,
    title: `${companyInfo.name || "Private Company"} - Financial Statements`,
    description: "Generated by FinSight AI",
    sections: [{
      properties: { page: { margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } } },
      headers: {
        default: new Header({
          children: [
            para(
              [text(`${companyInfo.name || "Private Company"} ${companyInfo.period ? `Standalone Financial Statements for period ${companyInfo.period}` : ""}`, {
                font: "Arial", size: 14, italics: true, color: "8B4513"
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
  const safeName = (companyInfo.name || "Private_Company").replace(/[^a-zA-Z0-9]/g, '_');
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
      throw new Error("Document appears to be empty or unreadable.");
    }
    onProgress?.("Splitting document into sections...");
    const chunks = chunkText(extractedText, 25000);
    onProgress?.(`Document has ${chunks.length} sections. Beginning AI processing...`);
    const chunkResults = [];
    let companyInfo = { name: "", period: "", rounding: "Lakhs", currency: "INR" };
    for (let i = 0; i < chunks.length; i++) {
      const chunkResult = await processChunkWithAI(
        chunks[i], i + 1, chunks.length,
        i > 0 ? `Company: ${companyInfo.name || "unknown"}, Period: ${companyInfo.period || "unknown"}` : null,
        onProgress
      );
      chunkResults.push(chunkResult);
      if (chunkResult.companyInfoFound) {
        if (chunkResult.companyInfoFound.name && !companyInfo.name) companyInfo.name = chunkResult.companyInfoFound.name;
        if (chunkResult.companyInfoFound.period && !companyInfo.period) companyInfo.period = chunkResult.companyInfoFound.period;
        if (chunkResult.companyInfoFound.rounding) companyInfo.rounding = chunkResult.companyInfoFound.rounding;
        if (chunkResult.companyInfoFound.currency) companyInfo.currency = chunkResult.companyInfoFound.currency;
      }
    }
    onProgress?.("Generating your professional Word document...");
    await generateOrganizedWordDoc(chunkResults, companyInfo, file.name);
    return { success: true, fileName: file.name, chunkCount: chunks.length };
  } catch (error) {
    console.error("Private company doc processing error:", error);
    throw error;
  }
}

async function generatePPT(data, periodLabel) {
  const PptxGenJS = await loadPptxGenJS();
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = `FinSight AI - ${data.company} Analysis`;
  pptx.author = AUTHOR_NAME;

  const PPT_COLORS = {
    bgPage: "F9F7F4", bgCard: "FFFFFF", bgSidebar: "EFEBE4",
    border: "E8E1D8", accent: "CF6B4E", accentDark: "A8553C", accentLight: "FDF0EC",
    textPrimary: "1F1B18", textSec: "6B6158", textMuted: "9E9890",
    green: "2D7D5C", greenBg: "F0FAF5", red: "C04040", redBg: "FDF2F2",
  };

  const sym = data.currencySymbol || "$";
  const cur = data.currency || "USD";
  const today = new Date().toISOString().split('T')[0];
  const lastIdx = (data.years?.length || 1) - 1;

  const s1 = pptx.addSlide();
  s1.background = { color: PPT_COLORS.bgPage };
  s1.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: PPT_COLORS.bgPage }, line: { color: PPT_COLORS.bgPage, width: 0 } });
  s1.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.4, fill: { color: PPT_COLORS.accent }, line: { color: PPT_COLORS.accent, width: 0 } });
  s1.addText('FINSIGHT AI', { x: 0.6, y: 1.5, w: 12, h: 0.5, fontSize: 14, fontFace: 'Calibri', bold: true, color: PPT_COLORS.accent, charSpacing: 6 });
  s1.addText(data.company || 'Company Analysis', { x: 0.6, y: 2.0, w: 12, h: 1.2, fontSize: 48, fontFace: 'Calibri', bold: true, color: PPT_COLORS.textPrimary });
  s1.addText(`${data.ticker || ''} • ${data.exchange || ''} • ${data.sector || ''}`, { x: 0.6, y: 3.3, w: 12, h: 0.4, fontSize: 16, fontFace: 'Calibri', color: PPT_COLORS.textSec });
  s1.addShape(pptx.ShapeType.rect, { x: 0.6, y: 4.0, w: 1.2, h: 0.04, fill: { color: PPT_COLORS.accent }, line: { color: PPT_COLORS.accent, width: 0 } });
  s1.addText(`Financial Analysis Report  •  ${periodLabel}`, { x: 0.6, y: 4.2, w: 12, h: 0.4, fontSize: 18, fontFace: 'Calibri', color: PPT_COLORS.textPrimary });
  s1.addText(`Generated: ${today}  •  Data as of: ${data.dataAsOf || 'Latest'}`, { x: 0.6, y: 4.7, w: 12, h: 0.3, fontSize: 12, fontFace: 'Calibri', color: PPT_COLORS.textMuted });
  s1.addText(`by ${AUTHOR_NAME}`, { x: 0.6, y: 7.0, w: 12, h: 0.3, fontSize: 11, fontFace: 'Calibri', italic: true, color: PPT_COLORS.textMuted });

  return { pptx, data, PPT_COLORS, sym, cur, today, lastIdx };
}

async function finishPPT(partial) {
  const { pptx, data, PPT_COLORS, sym, cur, today, lastIdx } = partial;

  const s2 = pptx.addSlide();
  s2.background = { color: PPT_COLORS.bgCard };
  s2.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.15, fill: { color: PPT_COLORS.accent }, line: { color: PPT_COLORS.accent, width: 0 } });
  s2.addText('COMPANY OVERVIEW', { x: 0.6, y: 0.5, w: 12, h: 0.5, fontSize: 22, fontFace: 'Calibri', bold: true, color: PPT_COLORS.textPrimary, charSpacing: 2 });
  s2.addText(data.description || 'Description not available', { x: 0.6, y: 1.2, w: 12, h: 1.5, fontSize: 14, fontFace: 'Calibri', color: PPT_COLORS.textSec, valign: 'top' });

  const overviewItems = [
    { label: 'Sector', value: data.sector || 'N/A' },
    { label: 'Exchange', value: data.exchange || 'N/A' },
    { label: 'Currency', value: `${cur} (${sym})` },
    { label: 'Market Cap', value: fmtMoney(data.marketCap, sym) },
  ];
  overviewItems.forEach((item, i) => {
    const x = 0.6 + (i % 4) * 3.1;
    const y = 3.0;
    s2.addShape(pptx.ShapeType.rect, { x, y, w: 2.9, h: 1.3, fill: { color: PPT_COLORS.bgPage }, line: { color: PPT_COLORS.border, width: 1 }, rectRadius: 0.1 });
    s2.addText(item.label.toUpperCase(), { x: x + 0.2, y: y + 0.15, w: 2.5, h: 0.3, fontSize: 10, fontFace: 'Calibri', bold: true, color: PPT_COLORS.textMuted, charSpacing: 1 });
    s2.addText(item.value, { x: x + 0.2, y: y + 0.5, w: 2.5, h: 0.6, fontSize: 18, fontFace: 'Calibri', bold: true, color: PPT_COLORS.textPrimary });
  });
  s2.addText(`FinSight AI  •  by ${AUTHOR_NAME}`, { x: 0.6, y: 7.1, w: 12, h: 0.3, fontSize: 9, fontFace: 'Calibri', color: PPT_COLORS.textMuted });

  const s3 = pptx.addSlide();
  s3.background = { color: PPT_COLORS.bgCard };
  s3.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.15, fill: { color: PPT_COLORS.accent }, line: { color: PPT_COLORS.accent, width: 0 } });
  s3.addText('KEY FINANCIAL METRICS', { x: 0.6, y: 0.5, w: 12, h: 0.5, fontSize: 22, fontFace: 'Calibri', bold: true, color: PPT_COLORS.textPrimary, charSpacing: 2 });
  s3.addText(`Latest period: ${data.years?.[lastIdx] || 'N/A'}`, { x: 0.6, y: 1.0, w: 12, h: 0.3, fontSize: 12, fontFace: 'Calibri', color: PPT_COLORS.textMuted });

  const metrics = [
    { label: 'Revenue', value: fmtMoney(data.revenue?.[lastIdx], sym), sub: data.revenueCAGR ? `CAGR ${Number(data.revenueCAGR).toFixed(1)}%` : 'Latest' },
    { label: 'Net Income', value: fmtMoney(data.netIncome?.[lastIdx], sym), sub: data.netMargin?.[lastIdx] ? `${Number(data.netMargin[lastIdx]).toFixed(1)}% margin` : '' },
    { label: 'EBITDA', value: fmtMoney(data.ebitda?.[lastIdx], sym), sub: 'Operating earnings' },
    { label: 'Free Cash Flow', value: fmtMoney(data.freeCashFlow?.[lastIdx], sym), sub: 'After capex' },
    { label: 'EPS', value: data.eps?.[lastIdx] != null ? `${sym}${Number(data.eps[lastIdx]).toFixed(2)}` : 'N/A', sub: 'Per share' },
    { label: 'P/E Ratio', value: data.peRatio ? `${Number(data.peRatio).toFixed(1)}x` : 'N/A', sub: 'Current' },
  ];
  metrics.forEach((m, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 0.6 + col * 4.15, y = 1.7 + row * 2.6;
    s3.addShape(pptx.ShapeType.rect, { x, y, w: 3.95, h: 2.4, fill: { color: PPT_COLORS.bgPage }, line: { color: PPT_COLORS.border, width: 1 }, rectRadius: 0.1 });
    s3.addShape(pptx.ShapeType.rect, { x, y, w: 3.95, h: 0.06, fill: { color: PPT_COLORS.accent }, line: { color: PPT_COLORS.accent, width: 0 } });
    s3.addText(m.label.toUpperCase(), { x: x + 0.25, y: y + 0.3, w: 3.45, h: 0.3, fontSize: 11, fontFace: 'Calibri', bold: true, color: PPT_COLORS.textMuted, charSpacing: 1 });
    s3.addText(m.value, { x: x + 0.25, y: y + 0.7, w: 3.45, h: 0.9, fontSize: 28, fontFace: 'Calibri', bold: true, color: PPT_COLORS.textPrimary });
    s3.addText(m.sub, { x: x + 0.25, y: y + 1.7, w: 3.45, h: 0.3, fontSize: 11, fontFace: 'Calibri', color: PPT_COLORS.textSec });
  });
  s3.addText(`FinSight AI  •  by ${AUTHOR_NAME}`, { x: 0.6, y: 7.1, w: 12, h: 0.3, fontSize: 9, fontFace: 'Calibri', color: PPT_COLORS.textMuted });

  const s8 = pptx.addSlide();
  s8.background = { color: PPT_COLORS.bgCard };
  s8.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.15, fill: { color: PPT_COLORS.accent }, line: { color: PPT_COLORS.accent, width: 0 } });
  s8.addText('AI FINANCIAL ANALYSIS', { x: 0.6, y: 0.5, w: 12, h: 0.5, fontSize: 22, fontFace: 'Calibri', bold: true, color: PPT_COLORS.textPrimary, charSpacing: 2 });
  s8.addText('Key insights across four dimensions of company performance', { x: 0.6, y: 1.0, w: 12, h: 0.3, fontSize: 12, fontFace: 'Calibri', color: PPT_COLORS.textMuted });

  const getFirst = (arr) => {
    if (!arr) return 'Analysis not available';
    if (Array.isArray(arr) && arr.length > 0) return cleanText(arr[0]) || 'No insight available';
    if (typeof arr === 'string') return cleanText(arr.split('.')[0] + '.') || 'No insight available';
    return 'Analysis not available';
  };
  const sections = [
    { icon: '📈', title: 'Revenue & Growth', textVal: getFirst(data.analysisRevenue), color: PPT_COLORS.accent },
    { icon: '💰', title: 'Profitability', textVal: getFirst(data.analysisProfitability), color: PPT_COLORS.green },
    { icon: '💵', title: 'Cash Flow', textVal: getFirst(data.analysisCashFlow), color: '3B82B0' },
    { icon: '🎯', title: 'Strategic Outlook', textVal: getFirst(data.analysisOutlook), color: '7C5CB8' },
  ];
  sections.forEach((sec, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.6 + col * 6.2, y = 1.7 + row * 2.8;
    s8.addShape(pptx.ShapeType.rect, { x, y, w: 6.0, h: 2.5, fill: { color: PPT_COLORS.bgPage }, line: { color: PPT_COLORS.border, width: 1 }, rectRadius: 0.15 });
    s8.addShape(pptx.ShapeType.rect, { x, y, w: 6.0, h: 0.08, fill: { color: sec.color }, line: { color: sec.color, width: 0 } });
    s8.addText(sec.icon, { x: x + 0.3, y: y + 0.25, w: 0.6, h: 0.6, fontSize: 28 });
    s8.addText(sec.title.toUpperCase(), { x: x + 1.0, y: y + 0.3, w: 4.8, h: 0.35, fontSize: 13, fontFace: 'Calibri', bold: true, color: sec.color, charSpacing: 2 });
    s8.addText(sec.textVal, { x: x + 0.3, y: y + 1.0, w: 5.5, h: 1.4, fontSize: 12, fontFace: 'Calibri', color: PPT_COLORS.textSec, valign: 'top' });
  });
  s8.addText(`FinSight AI  •  by ${AUTHOR_NAME}`, { x: 0.6, y: 7.1, w: 12, h: 0.3, fontSize: 9, fontFace: 'Calibri', color: PPT_COLORS.textMuted });

  const s9 = pptx.addSlide();
  s9.background = { color: PPT_COLORS.bgCard };
  s9.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.15, fill: { color: PPT_COLORS.accent }, line: { color: PPT_COLORS.accent, width: 0 } });
  s9.addText('KEY STRENGTHS & RISKS', { x: 0.6, y: 0.5, w: 12, h: 0.5, fontSize: 22, fontFace: 'Calibri', bold: true, color: PPT_COLORS.textPrimary, charSpacing: 2 });
  s9.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.6, w: 6.0, h: 5.3, fill: { color: PPT_COLORS.greenBg }, line: { color: PPT_COLORS.green, width: 2 }, rectRadius: 0.15 });
  s9.addText('✓  KEY STRENGTHS', { x: 0.9, y: 1.85, w: 5.5, h: 0.4, fontSize: 16, fontFace: 'Calibri', bold: true, color: PPT_COLORS.green, charSpacing: 2 });
  (data.keyStrengths || []).slice(0, 5).forEach((s, i) => {
    const y = 2.5 + i * 0.85;
    s9.addShape(pptx.ShapeType.ellipse, { x: 0.95, y: y + 0.05, w: 0.35, h: 0.35, fill: { color: PPT_COLORS.green }, line: { color: PPT_COLORS.green, width: 0 } });
    s9.addText(`${i + 1}`, { x: 0.95, y: y + 0.05, w: 0.35, h: 0.35, fontSize: 11, fontFace: 'Calibri', bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' });
    s9.addText(cleanText(s) || '', { x: 1.45, y, w: 5.0, h: 0.8, fontSize: 11, fontFace: 'Calibri', color: PPT_COLORS.textSec, valign: 'top' });
  });
  s9.addShape(pptx.ShapeType.rect, { x: 6.8, y: 1.6, w: 6.0, h: 5.3, fill: { color: PPT_COLORS.redBg }, line: { color: PPT_COLORS.red, width: 2 }, rectRadius: 0.15 });
  s9.addText('⚠  KEY RISKS', { x: 7.1, y: 1.85, w: 5.5, h: 0.4, fontSize: 16, fontFace: 'Calibri', bold: true, color: PPT_COLORS.red, charSpacing: 2 });
  (data.keyRisks || []).slice(0, 5).forEach((r, i) => {
    const y = 2.5 + i * 0.85;
    s9.addShape(pptx.ShapeType.ellipse, { x: 7.15, y: y + 0.05, w: 0.35, h: 0.35, fill: { color: PPT_COLORS.red }, line: { color: PPT_COLORS.red, width: 0 } });
    s9.addText(`${i + 1}`, { x: 7.15, y: y + 0.05, w: 0.35, h: 0.35, fontSize: 11, fontFace: 'Calibri', bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' });
    s9.addText(cleanText(r) || '', { x: 7.65, y, w: 5.0, h: 0.8, fontSize: 11, fontFace: 'Calibri', color: PPT_COLORS.textSec, valign: 'top' });
  });
  s9.addText(`FinSight AI  •  by ${AUTHOR_NAME}`, { x: 0.6, y: 7.1, w: 12, h: 0.3, fontSize: 9, fontFace: 'Calibri', color: PPT_COLORS.textMuted });

  const s10 = pptx.addSlide();
  s10.background = { color: PPT_COLORS.bgPage };
  s10.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.4, fill: { color: PPT_COLORS.accent }, line: { color: PPT_COLORS.accent, width: 0 } });
  const outlookColor10 = data.outlook === 'Positive' || data.outlook === 'Bullish' ? PPT_COLORS.green : data.outlook === 'Caution' || data.outlook === 'Bearish' ? PPT_COLORS.red : 'A8761F';
  const outlookBg10 = data.outlook === 'Positive' || data.outlook === 'Bullish' ? PPT_COLORS.greenBg : data.outlook === 'Caution' || data.outlook === 'Bearish' ? PPT_COLORS.redBg : 'FEF7E6';
  s10.addText('FINAL VERDICT', { x: 0.6, y: 0.8, w: 12, h: 0.5, fontSize: 22, fontFace: 'Calibri', bold: true, color: PPT_COLORS.textPrimary, charSpacing: 2 });
  s10.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.5, w: 12.1, h: 2.5, fill: { color: outlookBg10 }, line: { color: outlookColor10, width: 3 }, rectRadius: 0.2 });
  s10.addText(`◎  ${(data.outlook || 'Mixed').toUpperCase()} OUTLOOK`, { x: 0.6, y: 1.8, w: 12.1, h: 0.6, fontSize: 28, fontFace: 'Calibri', bold: true, color: outlookColor10, align: 'center', charSpacing: 3 });
  s10.addText(cleanText(data.outlookReason) || 'Outlook reasoning not available.', { x: 1.5, y: 2.6, w: 10.3, h: 1.2, fontSize: 15, fontFace: 'Calibri', color: PPT_COLORS.textSec, align: 'center', valign: 'top' });
  s10.addText('FINSIGHT AI', { x: 0.6, y: 6.95, w: 12, h: 0.25, fontSize: 14, fontFace: 'Calibri', bold: true, color: PPT_COLORS.accent, align: 'center', charSpacing: 4 });
  s10.addText(`Financial intelligence, one company at a time  •  by ${AUTHOR_NAME}  •  finsightai.org`, { x: 0.6, y: 7.2, w: 12, h: 0.25, fontSize: 10, fontFace: 'Calibri', color: PPT_COLORS.textMuted, align: 'center' });

  const cleanCompany = (data.company || "Company").replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
  const cleanPeriodName = (partial.periodLabel || "Analysis").replace(/\s+/g, '');
  const filename = `FinSight_${cleanCompany}_${cleanPeriodName}_${new Date().toISOString().split('T')[0]}.pptx`;
  await pptx.writeFile({ fileName: filename });
}

async function generatePPTFull(data, periodLabel) {
  const partial = await generatePPT(data, periodLabel);
  partial.periodLabel = periodLabel;
  await finishPPT(partial);
}

async function generateExcel(data, periodLabel) {
  const XLSX = await loadSheetJS();
  const wb = XLSX.utils.book_new();
  const sym = data.currencySymbol || "$";
  const cur = data.currency || "USD";
  const today = new Date().toISOString().split('T')[0];
  const lastIdx = (data.years?.length || 1) - 1;

  const s1Data = [
    ["FINSIGHT AI — FINANCIAL ANALYSIS REPORT"], [`by ${AUTHOR_NAME}`], [""],
    ["COMPANY OVERVIEW"],
    ["Company Name", data.company || "N/A"], ["Ticker", data.ticker || "N/A"],
    ["Exchange", data.exchange || "N/A"], ["Market", data.market || "N/A"],
    ["Sector", data.sector || "N/A"], ["Currency", `${cur} (${sym})`],
    ["Analysis Period", periodLabel], ["Data As Of", data.dataAsOf || "N/A"],
    ["Report Generated", today], [""],
    ["DESCRIPTION"], [data.description || "N/A"], [""],
    ["KEY METRICS (LATEST PERIOD)"], ["Metric", "Value", "Context"],
    ["Revenue", fmtMoney(data.revenue?.[lastIdx], sym), `Period: ${data.years?.[lastIdx] || "N/A"}`],
    ["Net Income", fmtMoney(data.netIncome?.[lastIdx], sym), data.netMargin?.[lastIdx] ? `Margin: ${Number(data.netMargin[lastIdx]).toFixed(1)}%` : ""],
    ["EBITDA", fmtMoney(data.ebitda?.[lastIdx], sym), "Operating earnings"],
    ["Free Cash Flow", fmtMoney(data.freeCashFlow?.[lastIdx], sym), "Cash after capex"],
    ["EPS", data.eps?.[lastIdx] != null ? `${sym}${Number(data.eps[lastIdx]).toFixed(2)}` : "N/A", "Per share"],
    ["Market Cap", fmtMoney(data.marketCap, sym), "Total value"],
    ["P/E Ratio", data.peRatio ? `${Number(data.peRatio).toFixed(1)}x` : "N/A", "Current"],
    [""], ["OUTLOOK"], ["Rating", data.outlook || "N/A"], ["Reasoning", data.outlookReason || "N/A"],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(s1Data);
  ws1['!cols'] = [{ wch: 25 }, { wch: 35 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Executive Summary");

  const header = ["Metric", ...(data.years || [])];
  const fmtRow = (label, arr) => { const row = [label]; (arr || []).forEach(v => row.push(v != null ? v : "N/A")); return row; };
  const growthRow = (label, arr) => {
    const row = [label];
    (arr || []).forEach((v, i) => {
      const g = calcGrowth(arr, i);
      row.push(g != null ? `${g.toFixed(1)}%` : (i === 0 ? "Base" : "N/A"));
    });
    return row;
  };

  const s2Data = [
    ["FINANCIAL PERFORMANCE"], [`${data.company || ""} | ${periodLabel} | Values in ${cur} millions`], [""],
    ["ABSOLUTE VALUES (Millions)"], header,
    fmtRow("Revenue", data.revenue), fmtRow("Net Income", data.netIncome),
    fmtRow("EBITDA", data.ebitda), fmtRow("Free Cash Flow", data.freeCashFlow), [""],
    ["GROWTH RATES (Period-over-Period)"], header,
    growthRow("Revenue Growth", data.revenue), growthRow("Net Income Growth", data.netIncome),
    growthRow("EBITDA Growth", data.ebitda), growthRow("FCF Growth", data.freeCashFlow), [""],
    ["SUMMARY STATISTICS"],
    ["Revenue CAGR", data.revenueCAGR ? `${Number(data.revenueCAGR).toFixed(2)}%` : "N/A"],
    ["Latest Revenue", fmtMoney(data.revenue?.[lastIdx], sym)],
    ["Latest Net Income", fmtMoney(data.netIncome?.[lastIdx], sym)],
    ["Latest FCF", fmtMoney(data.freeCashFlow?.[lastIdx], sym)],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(s2Data);
  const colWidths2 = [{ wch: 22 }];
  (data.years || []).forEach(() => colWidths2.push({ wch: 16 }));
  ws2['!cols'] = colWidths2;
  XLSX.utils.book_append_sheet(wb, ws2, "Financial Performance");

  const s3Data = [
    ["PROFITABILITY & RATIOS"], [`${data.company || ""} | ${periodLabel}`], [""],
    ["MARGINS (%)"], header,
    fmtRow("Gross Margin", data.grossMargin), fmtRow("Net Margin", data.netMargin), [""],
    ["EARNINGS PER SHARE"], header,
    fmtRow(`EPS (${sym})`, data.eps), growthRow("EPS Growth", data.eps), [""],
    ["VALUATION METRICS"],
    ["P/E Ratio", data.peRatio ? `${Number(data.peRatio).toFixed(2)}x` : "N/A"],
    ["Market Cap", fmtMoney(data.marketCap, sym)], [""],
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(s3Data);
  const colWidths3 = [{ wch: 28 }];
  (data.years || []).forEach(() => colWidths3.push({ wch: 16 }));
  ws3['!cols'] = colWidths3;
  XLSX.utils.book_append_sheet(wb, ws3, "Profitability & Ratios");

  const s4Data = [["AI FINANCIAL ANALYSIS"], [`${data.company || ""} | Generated by FinSight AI`], [""]];
  const addSection = (icon, title, paragraphs) => {
    if (!paragraphs) return;
    s4Data.push([`${icon} ${title.toUpperCase()}`]); s4Data.push([""]);
    if (Array.isArray(paragraphs)) {
      paragraphs.forEach((p, i) => { s4Data.push([`${i + 1}.`, p]); s4Data.push([""]); });
    } else if (typeof paragraphs === "string") {
      s4Data.push(["", paragraphs]); s4Data.push([""]);
    }
    s4Data.push([""]);
  };
  if (data.analysisRevenue || data.analysisProfitability || data.analysisCashFlow || data.analysisOutlook) {
    addSection("📈", "Revenue & Growth Story", data.analysisRevenue);
    addSection("💰", "Profitability Performance", data.analysisProfitability);
    addSection("💵", "Cash Flow Analysis", data.analysisCashFlow);
    addSection("🎯", "Competitive & Strategic Outlook", data.analysisOutlook);
  } else if (data.analysis) {
    s4Data.push(["DETAILED ANALYSIS"]); s4Data.push([""]);
    String(data.analysis).split(/\n+/).filter(Boolean).forEach((p, i) => { s4Data.push([`${i + 1}.`, p]); s4Data.push([""]); });
  }
  const ws4 = XLSX.utils.aoa_to_sheet(s4Data);
  ws4['!cols'] = [{ wch: 5 }, { wch: 120 }];
  XLSX.utils.book_append_sheet(wb, ws4, "AI Analysis");

  const s5Data = [["KEY INSIGHTS"], [`${data.company || ""} | ${periodLabel}`], [""], ["✓ KEY STRENGTHS"], [""]];
  (data.keyStrengths || []).forEach((s, i) => s5Data.push([`${i + 1}.`, s]));
  s5Data.push([""], [""], ["⚠ KEY RISKS"], [""]);
  (data.keyRisks || []).forEach((r, i) => s5Data.push([`${i + 1}.`, r]));
  s5Data.push([""], [""], ["◎ OUTLOOK"], [""]);
  s5Data.push(["Rating", data.outlook || "N/A"]);
  s5Data.push(["Reasoning", data.outlookReason || "N/A"]);
  const ws5 = XLSX.utils.aoa_to_sheet(s5Data);
  ws5['!cols'] = [{ wch: 12 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, ws5, "Key Insights");

  const s6Data = [
    ["ABOUT THIS REPORT"], [""],
    ["Generated By", "FinSight AI"], ["Platform Creators", AUTHOR_NAME],
    ["Website", "https://finsightai.org"], ["Report Date", today], [""],
    ["DISCLAIMER"], [""],
    ["FinSight AI provides research and educational content only."],
    ["This is NOT investment advice."], ["We are NOT a SEBI-registered Investment Advisor."],
    ["Always verify information with original sources."], [""],
    [`© 2026 FinSight AI. Built by ${AUTHOR_NAME}.`],
  ];
  const ws6 = XLSX.utils.aoa_to_sheet(s6Data);
  ws6['!cols'] = [{ wch: 25 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, ws6, "About & Sources");

  const cleanCompany = (data.company || "Company").replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
  const cleanPeriod = periodLabel.replace(/\s+/g, '');
  const filename = `FinSight_${cleanCompany}_${cleanPeriod}_${today}.xlsx`;
  XLSX.writeFile(wb, filename);
}

function buildSystemPrompt(period) {
  const today = new Date().toISOString().split('T')[0];
  const currentYear = new Date().getFullYear();
  const periodInstructions = {
    latest_quarter: `Return data for the MOST RECENT QUARTER only.\n- "years" array: Quarter labels like ["Q3 FY26"]\n- All financial arrays: 1 value each`,
    half_yearly: `Return data for LAST 2 QUARTERS.\n- "years" array: ["Q2 FY26", "Q3 FY26"]\n- All financial arrays: 2 values each`,
    "1_year": `Return data for LAST 4 QUARTERS.\n- "years" array: ["Q4 FY25", "Q1 FY26", "Q2 FY26", "Q3 FY26"]\n- All financial arrays: 4 values each`,
    "2_year": `Return data for LAST 2 FISCAL YEARS.\n- "years" array: ["FY25", "FY26"]\n- All financial arrays: 2 values each`,
    "3_year": `Return data for LAST 3 FISCAL YEARS.\n- "years" array: ["FY24", "FY25", "FY26"]\n- All financial arrays: 3 values each`,
    "5_year": `Return data for LAST 5 FISCAL YEARS.\n- "years" array: ["FY22", "FY23", "FY24", "FY25", "FY26"]\n- All financial arrays: 5 values each`,
  };

  return `You are FinSight AI, a financial research assistant for public companies. Today's date is ${today}.

CRITICAL: Retrieve MOST RECENT data. Indian: FY26 = April 2025 to March 2026. US: calendar year quarters (${currentYear}).

ANALYSIS PERIOD: ${period.toUpperCase()}
${periodInstructions[period] || periodInstructions["1_year"]}

OUTPUT: Return ONLY raw JSON. No markdown. No <cite> tags. Clean plain English.

Return this structure (monetary values in MILLIONS, percentages as numbers like 23.5):
{
  "company": "Full Name", "ticker": "SYMBOL", "market": "US or India", "exchange": "NSE/NYSE etc",
  "currency": "USD or INR", "currencySymbol": "$ or ₹", "sector": "sector",
  "description": "2 sentences about what the company does",
  "periodType": "${period}", "dataAsOf": "YYYY-MM-DD",
  "years": [label, label],
  "revenue": [n], "netIncome": [n], "ebitda": [n], "freeCashFlow": [n],
  "grossMargin": [n], "netMargin": [n], "eps": [n],
  "costStructure": [{ "cogsPct": n, "opexPct": n, "taxPct": n, "netProfitPct": n, "otherPct": n }],
  "marketCap": number, "peRatio": number, "revenueCAGR": number,
  "analysisRevenue": ["Para 1", "Para 2", "Para 3"],
  "analysisProfitability": ["Para 1", "Para 2", "Para 3"],
  "analysisCashFlow": ["Para 1", "Para 2", "Para 3"],
  "analysisOutlook": ["Para 1", "Para 2", "Para 3"],
  "analysis": "Combined summary",
  "keyStrengths": ["s1", "s2", "s3"],
  "keyRisks": ["r1", "r2", "r3"],
  "outlook": "Positive or Mixed or Caution", "outlookReason": "One sentence"
}

CRITICAL: NO <cite> tags. Clean text only. All arrays must match years length.`;
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
  <div className="fs-card fs-metric" style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 12px", boxShadow: C.shadow, transition: "all .2s", minWidth: 0 }}>
    <div style={{ color: C.textMuted, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 16, fontWeight: 500, color: accent || C.textPrimary, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    <div style={{ color: C.textMuted, fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>
  </div>
);

const Byline = () => <span style={{ color: C.textMuted, fontSize: 11.5, letterSpacing: ".3px" }}>by <span style={{ fontWeight: 600, color: C.accent }}>{AUTHOR_NAME}</span></span>;

function ChartFrame({ icon, title, subtitle, children, quickRead, quickReadColor }) {
  return (
    <div className="fs-chart-card" style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 16, padding: 22, boxShadow: C.shadow, display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 15, color: C.textPrimary, display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 18 }}>{icon}</span><span>{title}</span>
        </div>
        <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.5 }}>{subtitle}</div>
      </div>
      <div style={{ flex: 1 }}>{children}</div>
      {quickRead && (
        <div style={{ background: quickReadColor || C.accentLight, borderLeft: `3px solid ${quickReadColor ? C.green : C.accent}`, borderRadius: 6, padding: "10px 14px", fontSize: 12.5, lineHeight: 1.6, color: C.textSec }}>
          <span style={{ color: quickReadColor ? C.green : C.accent, fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: ".8px", display: "block", marginBottom: 3 }}>💡 Quick Read</span>
          {quickRead}
        </div>
      )}
    </div>
  );
}

function GrowthQualityChart({ data, sym }) {
  const hasData = data.revenue?.some(v => v != null);
  if (!hasData) return null;
  const chartData = data.years.map((y, i) => ({ year: String(y), Revenue: data.revenue?.[i], "Gross Margin": data.grossMargin?.[i], "Net Margin": data.netMargin?.[i] }));
  const axisStyle = { fontSize: 11, fill: C.textMuted };
  const gridStyle = { strokeDasharray: "4 4", stroke: C.border };
  const dataLen = chartData.length;
  const firstMargin = data.netMargin?.[0], lastMargin = data.netMargin?.[dataLen - 1];
  const marginTrend = lastMargin != null && firstMargin != null ? lastMargin - firstMargin : null;
  const revenueTrend = calcGrowth(data.revenue, dataLen - 1);
  let quickRead, quickColor;
  if (dataLen === 1) quickRead = `Revenue ${fmtMoney(data.revenue[0], sym)} with net margin of ${data.netMargin?.[0]?.toFixed(1) || "N/A"}%.`;
  else if (marginTrend != null && revenueTrend != null) {
    if (revenueTrend > 0 && marginTrend >= -0.5) { quickRead = "Revenue is growing AND margins are stable/expanding — high-quality growth."; quickColor = C.greenBg; }
    else if (revenueTrend > 0 && marginTrend < -0.5) quickRead = "Revenue growing BUT margins shrinking.";
    else if (revenueTrend < 0) quickRead = "Revenue declining. Check margins.";
    else quickRead = "Stable performance.";
  } else quickRead = "Compare revenue bars with margin lines.";

  return (
    <ChartFrame icon="📊" title="Growth Quality" subtitle="Revenue (bars) plotted against profit margins (lines)." quickRead={quickRead} quickReadColor={quickColor}>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={chartData} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
          <defs><linearGradient id="gqBar" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.chartA} stopOpacity={.9}/><stop offset="100%" stopColor={C.chartA} stopOpacity={.45}/></linearGradient></defs>
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

function CashQualityChart({ data, sym }) {
  const hasData = data.netIncome?.some(v => v != null) && data.freeCashFlow?.some(v => v != null);
  if (!hasData) return null;
  const chartData = data.years.map((y, i) => ({ year: String(y), "Net Income": data.netIncome?.[i], "Free Cash Flow": data.freeCashFlow?.[i] }));
  const axisStyle = { fontSize: 11, fill: C.textMuted };
  const gridStyle = { strokeDasharray: "4 4", stroke: C.border };
  const dataLen = chartData.length;
  const latestNI = data.netIncome?.[dataLen - 1], latestFCF = data.freeCashFlow?.[dataLen - 1];
  let quickRead, quickColor;
  if (latestNI != null && latestFCF != null && latestNI !== 0) {
    const ratio = latestFCF / latestNI;
    if (ratio >= 0.9) { quickRead = "Free Cash Flow matches Net Income — profits converting to real cash."; quickColor = C.greenBg; }
    else if (ratio >= 0.6) quickRead = "Cash flow moderately lower than profits. Monitor.";
    else if (ratio >= 0.3) quickRead = "Significant gap between profits and cash.";
    else { quickRead = "Cash flow much lower than profits. Potential red flag."; quickColor = C.redBg; }
  } else quickRead = "If cash flow bars match net income bars, profits are real cash.";

  return (
    <ChartFrame icon="💰" title="Cash Quality Check" subtitle="Compares reported profits with actual cash generated." quickRead={quickRead} quickReadColor={quickColor}>
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
      { name: "Operating Expenses", value: c.opexPct || 0, fill: COLORS.opex },
      { name: "Taxes", value: c.taxPct || 0, fill: COLORS.tax },
      { name: "Net Profit", value: c.netProfitPct || 0, fill: COLORS.netProfit },
    ].filter(d => d.value > 0);
    if (c.otherPct > 0) pieData.push({ name: "Other", value: c.otherPct, fill: COLORS.other });
    const netProfitPct = c.netProfitPct || 0;
    let quickRead, quickColor;
    if (netProfitPct >= 20) { quickRead = `Very strong profitability — ${netProfitPct.toFixed(1)}% net profit.`; quickColor = C.greenBg; }
    else if (netProfitPct >= 10) { quickRead = `Healthy profit margin of ${netProfitPct.toFixed(1)}%.`; quickColor = C.greenBg; }
    else if (netProfitPct >= 5) quickRead = `Modest profit margin of ${netProfitPct.toFixed(1)}%.`;
    else quickRead = `Thin profit margin of ${netProfitPct.toFixed(1)}%.`;

    return (
      <ChartFrame icon="🥧" title="Profit Structure" subtitle={`Where every ${sym}100 of revenue goes (${data.years[0]}).`} quickRead={quickRead} quickReadColor={quickColor}>
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
    return { year: String(y), "Cost of Goods": c.cogsPct || 0, "Operating Exp": c.opexPct || 0, "Taxes": c.taxPct || 0, "Net Profit": c.netProfitPct || 0, "Other": c.otherPct || 0 };
  });
  const axisStyle = { fontSize: 11, fill: C.textMuted };
  const gridStyle = { strokeDasharray: "4 4", stroke: C.border };
  const latestProfit = cs[cs.length - 1]?.netProfitPct, firstProfit = cs[0]?.netProfitPct;
  let quickRead, quickColor;
  if (latestProfit != null && firstProfit != null) {
    const delta = latestProfit - firstProfit;
    if (delta > 1) { quickRead = `Net profit grew from ${firstProfit.toFixed(1)}% to ${latestProfit.toFixed(1)}%.`; quickColor = C.greenBg; }
    else if (delta < -1) { quickRead = `Net profit shrank from ${firstProfit.toFixed(1)}% to ${latestProfit.toFixed(1)}%.`; quickColor = C.redBg; }
    else quickRead = `Profit share stable around ${latestProfit.toFixed(1)}%.`;
  } else quickRead = "Green slice growing = improving efficiency.";

  return (
    <ChartFrame icon="📊" title="Profit Structure Trend" subtitle="How 100% of revenue splits across costs, taxes, and profit over time." quickRead={quickRead} quickReadColor={quickColor}>
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

function EPSChart({ data, sym }) {
  const hasData = data.eps?.some(v => v != null);
  if (!hasData) return null;
  const chartData = data.years.map((y, i) => ({ year: String(y), EPS: data.eps?.[i], growth: calcGrowth(data.eps, i) }));
  const axisStyle = { fontSize: 11, fill: C.textMuted };
  const gridStyle = { strokeDasharray: "4 4", stroke: C.border };
  const dataLen = chartData.length;
  const latestEPS = data.eps?.[dataLen - 1], firstEPS = data.eps?.[0];
  let quickRead, quickColor;
  if (dataLen === 1) quickRead = `EPS of ${sym}${Number(latestEPS || 0).toFixed(2)}.`;
  else if (firstEPS != null && latestEPS != null && firstEPS !== 0) {
    const totalGrowth = ((latestEPS - firstEPS) / Math.abs(firstEPS)) * 100;
    if (totalGrowth > 50) { quickRead = `EPS grew ${totalGrowth.toFixed(0)}% — strong compounding.`; quickColor = C.greenBg; }
    else if (totalGrowth > 0) { quickRead = `EPS grew ${totalGrowth.toFixed(0)}%.`; quickColor = C.greenBg; }
    else if (totalGrowth > -10) quickRead = "EPS broadly flat.";
    else { quickRead = `EPS declined ${Math.abs(totalGrowth).toFixed(0)}%.`; quickColor = C.redBg; }
  } else quickRead = "Consistent EPS growth = shareholder wealth.";

  return (
    <ChartFrame icon="📈" title="Earnings Per Share (EPS)" subtitle="What each share earned in profits." quickRead={quickRead} quickReadColor={quickColor}>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 30, right: 10, left: 0, bottom: 5 }}>
          <defs><linearGradient id="epsGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.chartD} stopOpacity={.9}/><stop offset="100%" stopColor={C.chartD} stopOpacity={.55}/></linearGradient></defs>
          <CartesianGrid {...gridStyle} />
          <XAxis dataKey="year" tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={v => `${sym}${v}`} width={50} />
          <Tooltip content={<ChartTip sym={sym} />} />
          <Bar dataKey="EPS" fill="url(#epsGrad)" radius={[6, 6, 0, 0]} barSize={dataLen <= 2 ? 60 : dataLen <= 4 ? 45 : 35} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function AnalysisSection({ icon, title, accentColor, paragraphs }) {
  let parts = [];
  if (Array.isArray(paragraphs)) parts = paragraphs.filter(Boolean);
  else if (typeof paragraphs === "string") { parts = paragraphs.split(/\n\n+/).filter(Boolean); if (parts.length === 0) parts = [paragraphs]; }
  if (parts.length === 0) return null;
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22, boxShadow: C.shadow }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: `${accentColor}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{icon}</div>
        <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 15.5, color: C.textPrimary }}>{title}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {parts.map((para, i) => (
          <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ flexShrink: 0, width: 24, height: 24, borderRadius: "50%", background: `${accentColor}15`, color: accentColor, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Mono', monospace", fontSize: 11, fontWeight: 700, marginTop: 2 }}>{i + 1}</div>
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
        <div style={{ width: 32, height: 32, borderRadius: 8, background: badgeColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: color, fontWeight: 700, flexShrink: 0 }}>{icon}</div>
        <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 14.5, color: color }}>{title}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{ flexShrink: 0, width: 20, height: 20, borderRadius: "50%", background: badgeColor, color: color, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 700, marginTop: 2 }}>{i + 1}</div>
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
    <div ref={ref} className="fs-dropdown" style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen(!open)} className="fs-dropdown-btn" style={{ display: "flex", alignItems: "center", gap: 10, background: C.bgCard, border: `1.5px solid ${open ? C.accent : C.border}`, borderRadius: 14, padding: "0 16px", height: 52, minWidth: 150, fontSize: 14, fontWeight: 600, color: C.textPrimary, fontFamily: "'Plus Jakarta Sans', sans-serif", cursor: "pointer", boxShadow: C.shadow, transition: "border-color .15s", whiteSpace: "nowrap", justifyContent: "space-between", width: "100%" }}>
        <span>{selected.short}</span>
        <span style={{ fontSize: 10, color: C.textMuted, transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s", marginLeft: 4 }}>▼</span>
      </button>
      {open && (
        <div className="fs-dropdown-menu" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, width: "max(100%, 220px)", background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: C.shadowMd, zIndex: 50, overflow: "hidden" }}>
          {PERIODS.map(p => {
            const isActive = p.id === value;
            return (
              <button key={p.id} type="button" onClick={() => { onChange(p.id); setOpen(false); }} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, width: "100%", background: isActive ? C.accentLight : "transparent", border: "none", padding: "10px 14px", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: isActive ? C.accent : C.textPrimary }}>{p.label}{isActive && <span style={{ fontSize: 11, color: C.accent, marginLeft: 6 }}>✓</span>}</span>
                <span style={{ fontSize: 11, color: C.textMuted }}>{p.desc}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PrivateDocUploadZone({ onProcess, isProcessing, progress, error }) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    handleFile(files[0]);
  };
  const handleFileSelect = (e) => { const files = Array.from(e.target.files); handleFile(files[0]); };
  const handleFile = (file) => {
    if (!file) return;
    if (!file.name.match(/\.(docx?|doc)$/i)) {
      alert("Please upload a Word document (.docx or .doc)");
      return;
    }
    onProcess(file);
  };
  const handleClick = () => { fileInputRef.current?.click(); };

  return (
    <div style={{ width: "100%", maxWidth: 720, margin: "16px auto 0" }}>
      <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} onClick={!isProcessing ? handleClick : undefined}
        style={{
          padding: "28px 24px",
          background: isDragging ? C.brownLight : (isProcessing ? "#F5F5F5" : C.bgCard),
          border: `2px dashed ${isDragging ? C.brown : C.border}`,
          borderRadius: 14, cursor: isProcessing ? "wait" : "pointer", transition: "all 0.2s",
          textAlign: "center", opacity: isProcessing ? 0.85 : 1, boxShadow: C.shadow,
        }}>
        <input ref={fileInputRef} type="file" accept=".doc,.docx" onChange={handleFileSelect} style={{ display: "none" }} disabled={isProcessing} />
        {!isProcessing ? (
          <>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📄</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, marginBottom: 6 }}>Upload Private Company Financials</div>
            <div style={{ fontSize: 12.5, color: C.textSec, marginBottom: 8 }}>Drag & drop your Word document here, or click to browse</div>
            <div style={{ fontSize: 11, color: C.textMuted, fontStyle: "italic" }}>Multi-pass AI processing • Professionally organised financial analysis • Full preservation</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 24, marginBottom: 12, animation: "fs-spin 2s linear infinite", display: "inline-block" }}>⚙️</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.brown, marginBottom: 6 }}>{progress || "Processing..."}</div>
            <div style={{ fontSize: 11, color: C.textMuted }}>Multi-pass processing — may take 1-3 minutes for large documents</div>
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
  .fs-chip { transition: all .18s; }
  .fs-chip:hover { background: ${C.accentLight} !important; border-color: ${C.accent} !important; color: ${C.accent} !important; }
  .fs-btn-primary:hover { background: ${C.accentDark} !important; }
  .fs-card:hover { box-shadow: ${C.shadowMd} !important; border-color: ${C.borderHover} !important; }
  .fs-chart-card:hover { box-shadow: ${C.shadowMd} !important; border-color: ${C.borderHover} !important; }
  .fs-act:hover { opacity: .88 !important; transform: translateY(-1px); }
  .fs-act:disabled { opacity: .55 !important; cursor: not-allowed !important; transform: none !important; }
  .fs-dropdown-btn:hover { border-color: ${C.accent} !important; }
  @keyframes fs-fade { from{opacity:0;transform:translateY(12px);} to{opacity:1;transform:none;} }
  @keyframes fs-spin { to { transform: rotate(360deg); } }
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
            <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 28, color: C.textPrimary, letterSpacing: "-.8px", lineHeight: 1 }}>FinSight AI</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>by <span style={{ color: C.accent, fontWeight: 600 }}>{AUTHOR_NAME}</span></div>
          </div>
        </div>
        <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 20, color: C.textPrimary, marginBottom: 6 }}>Welcome to financial intelligence</h2>
        <p style={{ color: C.textSec, fontSize: 14 }}>Sign in to analyze any company's financials</p>
      </div>
      <SignIn appearance={{ elements: { rootBox: { width: "100%", maxWidth: 400 }, card: { background: C.bgCard, border: `1px solid ${C.border}`, boxShadow: C.shadow }, formButtonPrimary: { background: C.accent } } }} />
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
        userMsg: `Analyze LATEST financial data for: ${company}. Period: ${periodLabel} (${period}). Use web search for recent numbers. Include cost structure and EPS. Provide 4 segmented analysis sections, each 3 paragraphs. Return ONLY clean JSON with no citation tags.`,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        maxTokens: 6000,
      });
      let json = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      const s = json.indexOf("{"), e = json.lastIndexOf("}");
      if (s >= 0 && e >= 0) json = json.slice(s, e + 1);
      const parsed = JSON.parse(json);
      parsed.analysisRevenue = cleanText(parsed.analysisRevenue);
      parsed.analysisProfitability = cleanText(parsed.analysisProfitability);
      parsed.analysisCashFlow = cleanText(parsed.analysisCashFlow);
      parsed.analysisOutlook = cleanText(parsed.analysisOutlook);
      parsed.analysis = cleanText(parsed.analysis);
      parsed.keyStrengths = cleanText(parsed.keyStrengths);
      parsed.keyRisks = cleanText(parsed.keyRisks);
      parsed.outlookReason = cleanText(parsed.outlookReason);
      parsed.description = cleanText(parsed.description);
      setData(parsed);
      setScreen("dashboard");
    } catch (ex) {
      setErr(ex.message || "Analysis failed.");
      setScreen("error");
    }
  };

  const handlePrivateDocProcess = async (file) => {
    setPrivateDocLoading(true); setPrivateDocError(""); setPrivateDocProgress("");
    try {
      const result = await processPrivateCompanyDoc(file, (msg) => setPrivateDocProgress(msg));
      setPrivateDocProgress(`Done! Processed ${result.chunkCount} sections. Document downloaded.`);
      setTimeout(() => { setPrivateDocLoading(false); setPrivateDocProgress(""); }, 3000);
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
    } catch (ex) {
      alert("Excel download failed: " + (ex.message || "Unknown"));
    }
    setExcelLoading(false);
  };

  const downloadPPT = async () => {
    if (!data) return;
    setPptLoading(true);
    try {
      const periodLabel = PERIODS.find(p => p.id === (data.periodType || period))?.label || "1 Year";
      await new Promise(r => setTimeout(r, 500));
      await generatePPTFull(data, periodLabel);
    } catch (ex) {
      alert("PPT generation failed: " + (ex.message || "Unknown"));
      console.error(ex);
    }
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
        <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: "clamp(26px, 7vw, 48px)", fontWeight: 800, color: C.textPrimary, letterSpacing: "-1px", textAlign: "center", lineHeight: 1.15, marginBottom: 14 }}>
          Financial intelligence,<br /><span style={{ color: C.accent }}>one company at a time.</span>
        </h1>
        <p style={{ color: C.textSec, fontSize: 15, lineHeight: 1.7, textAlign: "center", maxWidth: 540, marginBottom: 32 }}>
          Type any company name. Get AI-powered financial analysis with interactive charts, Excel reports, and professional PPT decks.
        </p>

        <div className="fs-search-row" style={{ marginBottom: 32 }}>
          <PeriodDropdown value={period} onChange={setPeriod} />
          <div className="fs-search-bar">
            <input className="fs-input" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && q.trim() && analyze(q.trim())}
              placeholder="e.g. Apple, Reliance, Tesla..." style={{ flex: 1, background: "none", border: "none", outline: "none", color: C.textPrimary, fontSize: 15, fontFamily: "inherit", minWidth: 0 }} />
            <button className="fs-btn-primary" onClick={() => q.trim() && analyze(q.trim())} disabled={!q.trim()}
              style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontSize: 14, fontWeight: 600, fontFamily: "'Plus Jakarta Sans', sans-serif", cursor: "pointer", opacity: q.trim() ? 1 : .55 }}>
              Analyze →
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", marginBottom: 32 }}>
          {[{ flag: "🇺🇸", label: "US", items: US_EX }, { flag: "🇮🇳", label: "India", items: IN_EX }].map(row => (
            <div key={row.flag} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
              <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 500, minWidth: 70, textAlign: "right" }}>{row.flag} {row.label}</span>
              {row.items.map(c => <button key={c} className="fs-chip" onClick={() => analyze(c)}
                style={{ background: C.bgCard, border: `1px solid ${C.border}`, color: C.textSec, borderRadius: 20, padding: "5px 12px", fontSize: 12.5, fontFamily: "inherit", cursor: "pointer" }}>{c}</button>)}
            </div>
          ))}
        </div>

        <div style={{ width: "100%", maxWidth: 720, margin: "8px auto 8px", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ flex: 1, height: 1, background: C.border }}></div>
          <div style={{ fontSize: 11, color: C.brown, fontWeight: 700, letterSpacing: "0.08em", padding: "4px 12px", background: C.brownLight, border: `1px solid ${C.border}`, borderRadius: 20 }}>
            OR ORGANIZE PRIVATE COMPANY DOCS
          </div>
          <div style={{ flex: 1, height: 1, background: C.border }}></div>
        </div>

        <PrivateDocUploadZone onProcess={handlePrivateDocProcess} isProcessing={privateDocLoading} progress={privateDocProgress} error={privateDocError} />

        <div style={{ marginTop: 16, fontSize: 11.5, color: C.textMuted, textAlign: "center", maxWidth: 640, lineHeight: 1.6 }}>
          <strong style={{ color: C.textSec }}>How it works:</strong> Upload a private company Word doc. Multi-pass AI processing preserves every detail —
          balance sheet, P&L, cash flow, all notes — and returns a professionally organized B Braun-style Word document.
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
    const OUTLOOK = { Positive: { color: C.green, bg: C.greenBg }, Mixed: { color: C.amber, bg: C.amberBg }, Caution: { color: C.red, bg: C.redBg }, Bullish: { color: C.green, bg: C.greenBg }, Neutral: { color: C.amber, bg: C.amberBg }, Bearish: { color: C.red, bg: C.redBg } };
    const oc = OUTLOOK[data.outlook] || OUTLOOK.Mixed;
    const lastIdx = (data.years?.length || 1) - 1;
    const latestRev = data.revenue?.[lastIdx], latestNI = data.netIncome?.[lastIdx];
    const latestFCF = data.freeCashFlow?.[lastIdx], latestNM = data.netMargin?.[lastIdx];
    const latestLabel = data.years?.[lastIdx] || "Latest";
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 15, fontWeight: 700, color: C.textPrimary }}>{data.company}</span>
            <span style={{ background: C.bgSidebar, color: C.textSec, fontSize: 10.5, fontFamily: "'DM Mono', monospace", padding: "2px 7px", borderRadius: 5, border: `1px solid ${C.border}` }}>{data.ticker}</span>
            <span style={{ background: C.bgSidebar, color: C.textMuted, fontSize: 10.5, padding: "2px 7px", borderRadius: 5, border: `1px solid ${C.border}` }}>{data.exchange}</span>
            <span style={{ background: C.accentLight, color: C.accent, fontSize: 10.5, fontWeight: 600, padding: "2px 9px", borderRadius: 5 }}>{periodLabel}</span>
            <span style={{ background: oc.bg, color: oc.color, fontSize: 10.5, fontWeight: 600, padding: "2px 9px", borderRadius: 5 }}>{data.outlook}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
            <button onClick={() => setScreen("landing")} style={{ background: "none", border: `1px solid ${C.border}`, color: C.textSec, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>← New</button>
            <UserButton afterSignOutUrl="/" />
          </div>
        </header>

        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 24px 22px" }}>
          <p style={{ color: C.textSec, fontSize: 14, lineHeight: 1.75, maxWidth: 680, marginBottom: 28 }}>{data.description}</p>
          {data.dataAsOf && <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 14 }}>📅 Data as of: <strong style={{ color: C.textSec }}>{data.dataAsOf}</strong> · Period: <strong style={{ color: C.accent }}>{periodLabel}</strong></div>}

          <div className="fs-metrics-grid" style={{ marginBottom: 24 }}>
            {[
              { label: `${latestLabel} Revenue`, value: fmtMoney(latestRev, sym), sub: data.revenueCAGR ? `CAGR ${Number(data.revenueCAGR).toFixed(1)}%` : "Latest" },
              { label: `${latestLabel} Net Income`, value: fmtMoney(latestNI, sym), sub: latestNM ? `Margin ${Number(latestNM).toFixed(1)}%` : "Latest" },
              { label: "Market Cap", value: fmtMoney(data.marketCap, sym), sub: data.exchange },
              { label: "P/E Ratio", value: data.peRatio ? `${Number(data.peRatio).toFixed(1)}×` : "N/A", sub: "Current" },
              { label: "Free Cash Flow", value: fmtMoney(latestFCF, sym), sub: latestLabel },
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
            <button className="fs-act" onClick={downloadPPT} disabled={pptLoading}
              style={{ background: C.accent, color: "#fff", border: "none", padding: "12px 24px", borderRadius: 12, fontSize: 14, fontWeight: 600, fontFamily: "'Plus Jakarta Sans', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
              {pptLoading ? <><Spinner /> Creating PPT…</> : <>📊 Download PPT</>}
            </button>
            <button className="fs-act" onClick={downloadExcel} disabled={excelLoading}
              style={{ background: C.chartB, color: "#fff", border: "none", padding: "12px 24px", borderRadius: 12, fontSize: 14, fontWeight: 600, fontFamily: "'Plus Jakarta Sans', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
              {excelLoading ? <><Spinner /> Generating…</> : <>📗 Download Excel</>}
            </button>
            <button className="fs-act" onClick={() => setScreen("landing")}
              style={{ background: "transparent", color: C.textSec, border: `1px solid ${C.border}`, padding: "12px 24px", borderRadius: 12, fontSize: 14, fontWeight: 600, fontFamily: "'Plus Jakarta Sans', sans-serif", cursor: "pointer" }}>
              ← New search
            </button>
          </div>

          <div style={{ background: C.bgSidebar, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 11.5, color: C.textMuted, lineHeight: 1.6 }}>
            <strong style={{ color: C.textSec }}>Disclaimer:</strong> FinSight AI provides research and educational content only. This is not investment advice. We are not a SEBI-registered Investment Advisor. Verify information with original sources.
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
