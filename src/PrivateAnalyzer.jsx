import { useState, useRef, useCallback } from 'react';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber
} from 'docx';
import ExcelJS from 'exceljs';

const NAVY = '#0A1628';
const GREEN = '#0D7A3E';
const ORANGE = '#FF6600';

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}

const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';

async function loadPdfJs() {
  if (window._papdfjsLib) return window._papdfjsLib;
  const mod = await import(/* @vite-ignore */ PDFJS_CDN);
  const lib = mod.default ?? mod;
  lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  window._papdfjsLib = lib;
  return lib;
}

async function extractTextFromPDF(file) {
  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = '';
  const totalPages = pdf.numPages;
  const maxPages = Math.min(totalPages, 80);

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += `\n--- PAGE ${i} ---\n` + pageText;
  }

  const charCount = fullText.replace(/\s/g, '').length;
  const isScanned = charCount < (maxPages * 50);
  return { text: fullText, numPages: totalPages, isScanned };
}

// Render pages to JPEG images via canvas for scanned PDFs
async function extractTextViaVision(file, maxPages = 8) {
  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pagesToProcess = Math.min(pdf.numPages, maxPages);

  const pageImages = [];
  for (let i = 1; i <= pagesToProcess; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    pageImages.push(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
  }

  return pageImages;
}

function fmtNum(v) {
  if (v === null || v === undefined) return '-';
  const n = parseFloat(String(v).replace(/,/g, ''));
  if (isNaN(n)) return '-';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 1 });
}

// ── Word document ──────────────────────────────────────────────────────────────

function makeShading(fill) {
  return { type: ShadingType.CLEAR, color: 'auto', fill };
}

function hCell(text, fillHex, opts = {}) {
  return new TableCell({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: String(text ?? ''), bold: true, color: 'FFFFFF', size: 18, font: 'Arial' })]
    })],
    shading: makeShading(fillHex),
    verticalAlign: VerticalAlign.CENTER,
    ...opts
  });
}

function dCell(text, fillHex, bold = false, center = true) {
  return new TableCell({
    children: [new Paragraph({
      alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: [new TextRun({ text: String(text ?? '-'), bold, size: 18, font: 'Arial' })]
    })],
    shading: makeShading(fillHex),
    verticalAlign: VerticalAlign.CENTER,
  });
}

const thinBorderSpec = { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' };
const tableBorders = {
  top: thinBorderSpec, bottom: thinBorderSpec,
  left: thinBorderSpec, right: thinBorderSpec,
  insideH: thinBorderSpec, insideV: thinBorderSpec,
};

function sectionHeading(num, title) {
  return new Paragraph({
    children: [new TextRun({ text: `${num}. ${title}`, bold: true, size: 28, color: '0A1628', font: 'Arial' })],
    spacing: { before: 320, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'FF6600' } }
  });
}

function makeFinTable(analysis, rows, sectionKey, caption, years) {
  const sectionData = analysis[sectionKey] || {};
  const PALE = 'EBF0F7';
  const WHITE = 'FFFFFF';
  const LG = 'F5F7FA';

  const totalLabels = new Set(['Revenue', 'Gross Profit', 'EBITDA', 'EBIT', 'PBT', 'Net Income',
    'Total Current Assets', 'Total Assets', 'Total Current Liabilities', 'Total Liabilities', 'Total Equity',
    'Cash Flow from Operations (CFO)', 'Free Cash Flow']);

  const headerRow = new TableRow({
    children: [
      hCell(caption, '0A1628', { width: { size: 4500, type: WidthType.DXA } }),
      ...years.map(yr => hCell(yr, '1A3A5C', { width: { size: 2000, type: WidthType.DXA } }))
    ]
  });

  const dataRows = rows.map(([label, key], idx) => {
    const isTotal = totalLabels.has(label);
    const fill = isTotal ? PALE : (idx % 2 === 0 ? WHITE : LG);
    return new TableRow({
      children: [
        dCell(label, fill, isTotal, false),
        ...years.map(yr => dCell(fmtNum(sectionData[key]?.[yr]), fill, isTotal, true))
      ]
    });
  });

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows], borders: tableBorders });
}

async function generateWordDoc(analysis, ratiosByYear) {
  const co = analysis.company_profile || {};
  const years = analysis.financial_years || [];
  const companyName = co.name || 'Private Company';
  const unit = co.reporting_unit || '';
  const PALE = 'EBF0F7';
  const WHITE = 'FFFFFF';
  const LG = 'F5F7FA';

  // KPI strip
  const kpiYear = years[years.length - 1] || '';
  const is_ = analysis.income_statement || {};
  const ratioLast = ratiosByYear?.[kpiYear] || {};
  const kpis = [
    ['Revenue', fmtNum(is_.revenue?.[kpiYear])],
    ['EBITDA', fmtNum(is_.ebitda?.[kpiYear])],
    ['Net Income', fmtNum(is_.net_income?.[kpiYear])],
    ['Net Debt/EBITDA', ratioLast['Net Debt to EBITDA'] != null ? String(ratioLast['Net Debt to EBITDA']) : '-'],
    ['Unit', unit || '-'],
  ];
  const kpiTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: kpis.map(([label]) => hCell(label, '1A3A5C')) }),
      new TableRow({ children: kpis.map(([, val]) => new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: val, bold: true, size: 22, color: '0A1628', font: 'Arial' })] })],
        shading: makeShading(PALE), verticalAlign: VerticalAlign.CENTER,
      })) }),
    ],
    borders: tableBorders
  });

  // Profile table
  const profileFields = [
    ['Industry', co.industry], ['Sub-Industry', co.sub_industry],
    ['Headquarters', co.headquarters], ['Year Founded', co.year_founded],
    ['Legal Structure', co.legal_structure], ['Reporting Currency', co.reporting_currency],
    ['Reporting Unit', co.reporting_unit], ['Fiscal Year End', co.fiscal_year_end],
    ['Auditor', co.auditor], ['Employees', co.number_of_employees],
  ].filter(([, v]) => v != null && v !== '');

  const profileTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders,
    rows: profileFields.map(([label, value], idx) => new TableRow({
      children: [
        dCell(label, PALE, true, false),
        dCell(String(value), idx % 2 === 0 ? WHITE : LG, false, false),
      ]
    }))
  });

  // SWOT table
  const swot = analysis.swot || {};
  const swotColors = { strengths: '1A6B3C', weaknesses: '8B1A1A', opportunities: 'A87C1A', threats: '0A1628' };

  function swotCell(title, items, color) {
    return new TableCell({
      shading: makeShading(color),
      children: [
        new Paragraph({ children: [new TextRun({ text: title, bold: true, color: WHITE, size: 20, font: 'Arial' })], spacing: { after: 80 } }),
        ...(items || []).map(s => new Paragraph({ children: [new TextRun({ text: '• ' + s, color: WHITE, size: 17, font: 'Arial' })], spacing: { after: 40 } }))
      ]
    });
  }

  const swotTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders,
    rows: [
      new TableRow({ children: [swotCell('STRENGTHS', swot.strengths, swotColors.strengths), swotCell('WEAKNESSES', swot.weaknesses, swotColors.weaknesses)] }),
      new TableRow({ children: [swotCell('OPPORTUNITIES', swot.opportunities, swotColors.opportunities), swotCell('THREATS', swot.threats, swotColors.threats)] }),
    ]
  });

  // Ratio tables
  const ratioSections = [
    { title: 'Profitability', keys: ['Gross Margin %', 'EBITDA Margin %', 'EBIT Margin %', 'Net Profit Margin %', 'Return on Assets %', 'Return on Equity %', 'Return on Capital Employed %'] },
    { title: 'Liquidity', keys: ['Current Ratio', 'Quick Ratio', 'Cash Ratio', 'Operating CF Ratio'] },
    { title: 'Leverage', keys: ['Debt to Equity', 'Total Debt to Assets %', 'Equity Ratio %', 'Debt to EBITDA', 'Net Debt to EBITDA', 'Interest Cover (EBIT)', 'Interest Cover (EBITDA)'] },
    { title: 'Efficiency', keys: ['Asset Turnover', 'Fixed Asset Turnover', 'Inventory Days', 'Receivables Days (DSO)', 'Payables Days (DPO)'] },
    { title: 'Cash Flow', keys: ['FCF Margin %', 'Capex to Revenue %', 'CFO to Net Income'] },
    { title: 'Growth', keys: ['Revenue Growth %', 'Net Income Growth %', 'EBITDA Growth %'] },
  ];

  const ratioElements = ratioSections.flatMap(section => [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: tableBorders,
      rows: [
        new TableRow({ children: [hCell(section.title, '1A3A5C'), ...years.map(yr => hCell(yr, '0A1628'))] }),
        ...section.keys.map((key, idx) => new TableRow({
          children: [
            dCell(key, idx % 2 === 0 ? WHITE : LG, false, false),
            ...years.map(yr => dCell(ratiosByYear?.[yr]?.[key] != null ? String(ratiosByYear[yr][key]) : '-', idx % 2 === 0 ? WHITE : LG, false, true))
          ]
        }))
      ]
    }),
    new Paragraph({ text: '', spacing: { after: 120 } })
  ]);

  const pageBreak = () => new Paragraph({ text: '', pageBreakBefore: true });

  const doc = new Document({
    sections: [{
      headers: {
        default: new Header({
          children: [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '0A1628' } },
            children: [
              new TextRun({ text: companyName + '   |   ', bold: true, size: 18, font: 'Arial', color: '0A1628' }),
              new TextRun({ text: 'CONFIDENTIAL', bold: true, size: 18, font: 'Arial', color: 'FF6600' }),
            ]
          })]
        })
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'STRICTLY PRIVATE & CONFIDENTIAL  |  Page ', size: 16, font: 'Arial', color: '6B7280' }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, font: 'Arial', color: '6B7280' }),
              new TextRun({ text: ' of ', size: 16, font: 'Arial', color: '6B7280' }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, font: 'Arial', color: '6B7280' }),
            ]
          })]
        })
      },
      children: [
        // Cover
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1440, after: 240 }, children: [new TextRun({ text: companyName, bold: true, size: 72, color: '0A1628', font: 'Arial' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: co.industry || '', size: 28, color: '1A3A5C', font: 'Arial' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 480 }, children: [new TextRun({ text: 'PRIVATE COMPANY FINANCIAL ANALYSIS', bold: true, size: 24, color: 'FF6600', font: 'Arial' })] }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
          children: [new TextRun({
            text: years.length > 1
              ? `${years[0]} – ${years[years.length - 1]}`
              : (years[0] || ''),
            size: 22, color: '1A3A5C', font: 'Arial'
          })]
        }),
        kpiTable,
        pageBreak(),

        // 1. Company Profile
        sectionHeading('1', 'Company Profile'),
        new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: co.description || '', size: 18, font: 'Arial', color: '374151' })] }),
        profileTable,
        ...(co.key_products_services?.length ? [new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text: 'Key Products/Services: ', bold: true, size: 18, font: 'Arial' }), new TextRun({ text: co.key_products_services.join(', '), size: 18, font: 'Arial' })] })] : []),
        ...(co.geographic_presence?.length ? [new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: 'Geographic Presence: ', bold: true, size: 18, font: 'Arial' }), new TextRun({ text: co.geographic_presence.join(', '), size: 18, font: 'Arial' })] })] : []),
        pageBreak(),

        // 2. Key Observations
        sectionHeading('2', 'Key Analyst Observations'),
        ...(analysis.key_observations || []).map(obs => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: '• ' + obs, size: 18, font: 'Arial' })] })),
        pageBreak(),

        // 3. SWOT
        sectionHeading('3', 'SWOT Analysis'),
        swotTable,
        pageBreak(),

        // 4. Income Statement
        sectionHeading('4', 'Income Statement'),
        makeFinTable(analysis, [
          ['Revenue', 'revenue'], ['Cost of Goods Sold', 'cost_of_goods_sold'],
          ['Gross Profit', 'gross_profit'], ['Operating Expenses', 'operating_expenses'],
          ['EBITDA', 'ebitda'], ['Depreciation & Amortisation', 'depreciation_amortization'],
          ['EBIT', 'ebit'], ['Interest Expense', 'interest_expense'],
          ['PBT', 'pbt'], ['Tax', 'tax'], ['Net Income', 'net_income'],
        ], 'income_statement', `Income Statement (${unit})`, years),
        pageBreak(),

        // 5. Balance Sheet
        sectionHeading('5', 'Balance Sheet'),
        makeFinTable(analysis, [
          ['Cash & Equivalents', 'cash_equivalents'], ['Accounts Receivable', 'accounts_receivable'],
          ['Inventory', 'inventory'], ['Total Current Assets', 'total_current_assets'],
          ['Fixed Assets (Net)', 'fixed_assets_net'], ['Intangibles & Goodwill', 'intangibles_goodwill'],
          ['Total Assets', 'total_assets'], ['Accounts Payable', 'accounts_payable'],
          ['Short-Term Debt', 'short_term_debt'], ['Total Current Liabilities', 'total_current_liabilities'],
          ['Long-Term Debt', 'long_term_debt'], ['Total Liabilities', 'total_liabilities'],
          ['Share Capital', 'share_capital'], ['Retained Earnings', 'retained_earnings'],
          ['Total Equity', 'total_equity'],
        ], 'balance_sheet', `Balance Sheet (${unit})`, years),
        pageBreak(),

        // 6. Cash Flow
        sectionHeading('6', 'Cash Flow Statement'),
        makeFinTable(analysis, [
          ['Cash Flow from Operations (CFO)', 'cfo'], ['Cash Flow from Investing (CFI)', 'cfi'],
          ['Cash Flow from Financing (CFF)', 'cff'], ['Capital Expenditure (Capex)', 'capex'],
          ['Free Cash Flow', 'free_cash_flow'],
        ], 'cash_flow', `Cash Flow Statement (${unit})`, years),
        pageBreak(),

        // 7. Financial Ratios
        sectionHeading('7', 'Financial Ratios'),
        ...ratioElements,
        pageBreak(),

        // 8. Data Quality Notes
        sectionHeading('8', 'Data Quality Notes'),
        ...(analysis.data_quality_notes || []).map(note => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: '• ' + note, size: 18, font: 'Arial' })] })),
      ]
    }]
  });

  return Packer.toBlob(doc);
}

// ── Excel workbook ─────────────────────────────────────────────────────────────

async function generateExcelWorkbook(analysis, ratiosByYear) {
  const co = analysis.company_profile || {};
  const years = analysis.financial_years || [];
  const companyName = co.name || 'Private Company';

  const wb = new ExcelJS.Workbook();
  wb.creator = 'FinSight AI';

  const navyFill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A1628' } };
  const midFill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
  const orangeFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6600' } };
  const paleFill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBF0F7' } };
  const lgFill    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7FA' } };
  const whiteFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

  const hFont  = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  const bFont  = { name: 'Arial', size: 10 };
  const bbFont = { name: 'Arial', size: 10, bold: true };

  const thin = { style: 'thin', color: { argb: 'FFD1D5DB' } };
  const border4 = { top: thin, left: thin, bottom: thin, right: thin };

  function applyCell(ws, r, c, value, font, fill, align) {
    const cell = ws.getCell(r, c);
    cell.value = value;
    if (font) cell.font = font;
    if (fill) cell.fill = fill;
    if (align) cell.alignment = align;
    cell.border = border4;
  }

  // ── Sheet 1: Dashboard ──────────────────────────────────────────────────────
  const dash = wb.addWorksheet('Dashboard');
  dash.showGridLines = false;
  ['A', 'B', 'C', 'D', 'E', 'F'].forEach((col, i) => {
    dash.getColumn(col).width = i === 0 ? 32 : 18;
  });

  // Banner
  dash.mergeCells('A1:F1');
  applyCell(dash, 1, 1, companyName + '  —  Private Company Financial Analysis',
    { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } }, navyFill,
    { horizontal: 'center', vertical: 'middle' });
  dash.getRow(1).height = 36;

  // KPI cards
  const kpiYear = years[years.length - 1] || '';
  const is_ = analysis.income_statement || {};
  const bs_ = analysis.balance_sheet || {};
  const ratioLast = ratiosByYear?.[kpiYear] || {};
  const kpis = [
    ['Revenue', fmtNum(is_.revenue?.[kpiYear])],
    ['EBITDA', fmtNum(is_.ebitda?.[kpiYear])],
    ['Net Income', fmtNum(is_.net_income?.[kpiYear])],
    ['Total Assets', fmtNum(bs_.total_assets?.[kpiYear])],
    ['Net Debt/EBITDA', ratioLast['Net Debt to EBITDA'] ?? '-'],
    ['EBITDA Margin %', ratioLast['EBITDA Margin %'] ?? '-'],
  ];
  kpis.forEach(([label, value], i) => {
    const col = i + 1;
    applyCell(dash, 3, col, null, null, orangeFill, null);
    applyCell(dash, 4, col, label, { name: 'Arial', size: 9, bold: true, color: { argb: 'FF6B7280' } }, paleFill, { horizontal: 'center', vertical: 'middle' });
    applyCell(dash, 5, col, value, { name: 'Arial', size: 13, bold: true, color: { argb: 'FF0A1628' } }, paleFill, { horizontal: 'center', vertical: 'middle' });
    applyCell(dash, 6, col, co.reporting_unit || '', { name: 'Arial', size: 8, color: { argb: 'FF9CA3AF' } }, paleFill, { horizontal: 'center', vertical: 'middle' });
  });
  dash.getRow(3).height = 5;
  dash.getRow(5).height = 28;

  // SWOT
  dash.getRow(8).height = 20;
  dash.mergeCells('A8:F8');
  applyCell(dash, 8, 1, 'SWOT Analysis', { name: 'Arial', size: 13, bold: true, color: { argb: 'FF0A1628' } }, null, null);

  const swot = analysis.swot || {};
  const swotData = [
    { title: 'STRENGTHS',     items: swot.strengths     || [], fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A6B3C' } }, startCol: 1, colSpan: 3 },
    { title: 'WEAKNESSES',    items: swot.weaknesses    || [], fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B1A1A' } }, startCol: 4, colSpan: 3 },
    { title: 'OPPORTUNITIES', items: swot.opportunities || [], fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA87C1A' } }, startCol: 1, colSpan: 3 },
    { title: 'THREATS',       items: swot.threats       || [], fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A1628' } }, startCol: 4, colSpan: 3 },
  ];

  const maxTopItems = Math.max((swot.strengths || []).length, (swot.weaknesses || []).length, 1);
  let swotStartRow = 9;

  swotData.forEach((q, qi) => {
    if (qi === 2) swotStartRow += maxTopItems + 2;
    const r = swotStartRow;
    try { dash.mergeCells(r, q.startCol, r, q.startCol + q.colSpan - 1); } catch (e) {}
    const hc = dash.getCell(r, q.startCol);
    hc.value = q.title;
    hc.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    hc.fill = q.fill;
    hc.border = border4;
    dash.getRow(r).height = 20;

    q.items.forEach((item, itemIdx) => {
      const ir = r + 1 + itemIdx;
      try { dash.mergeCells(ir, q.startCol, ir, q.startCol + q.colSpan - 1); } catch (e) {}
      const ic = dash.getCell(ir, q.startCol);
      ic.value = '• ' + item;
      ic.font = { name: 'Arial', size: 9 };
      ic.fill = itemIdx % 2 === 0 ? whiteFill : lgFill;
      ic.border = border4;
      ic.alignment = { wrapText: true, vertical: 'middle' };
      dash.getRow(ir).height = 16;
    });
  });

  // Key Observations
  const obsStartRow = swotStartRow + Math.max((swot.opportunities || []).length, (swot.threats || []).length) + 4;
  dash.mergeCells(obsStartRow, 1, obsStartRow, 6);
  applyCell(dash, obsStartRow, 1, 'Key Analyst Observations',
    { name: 'Arial', size: 13, bold: true, color: { argb: 'FF0A1628' } }, null, null);
  dash.getRow(obsStartRow).height = 20;
  (analysis.key_observations || []).forEach((obs, i) => {
    const r = obsStartRow + 1 + i;
    try { dash.mergeCells(r, 1, r, 6); } catch (e) {}
    const c = dash.getCell(r, 1);
    c.value = '• ' + obs;
    c.font = { name: 'Arial', size: 9 };
    c.fill = i % 2 === 0 ? whiteFill : lgFill;
    c.border = border4;
    c.alignment = { wrapText: true, vertical: 'middle' };
    dash.getRow(r).height = 16;
  });

  // ── Helper: financial sheets ────────────────────────────────────────────────
  function makeFinSheet(name, rows, sectionKey) {
    const ws = wb.addWorksheet(name);
    ws.showGridLines = false;
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
    ws.getColumn(1).width = 36;
    years.forEach((_, i) => { ws.getColumn(i + 2).width = 17; });

    applyCell(ws, 1, 1, `${name}${co.reporting_unit ? ` (${co.reporting_unit})` : ''}`, hFont, navyFill, { vertical: 'middle' });
    years.forEach((yr, i) => applyCell(ws, 1, i + 2, yr, hFont, navyFill, { horizontal: 'center', vertical: 'middle' }));
    ws.getRow(1).height = 24;

    const sectionData = analysis[sectionKey] || {};
    const totalKeys = new Set(['revenue', 'gross_profit', 'ebitda', 'ebit', 'pbt', 'net_income',
      'total_current_assets', 'total_assets', 'total_current_liabilities', 'total_liabilities', 'total_equity',
      'cfo', 'free_cash_flow']);

    rows.forEach(([label, key], idx) => {
      const rowNum = idx + 2;
      const isTotal = totalKeys.has(key);
      const rowFill = isTotal ? paleFill : (idx % 2 === 0 ? whiteFill : lgFill);
      ws.getRow(rowNum).height = 18;

      applyCell(ws, rowNum, 1, label, isTotal ? bbFont : bFont, rowFill, { vertical: 'middle' });
      years.forEach((yr, yIdx) => {
        const raw = sectionData[key]?.[yr];
        const num = raw != null ? parseFloat(String(raw).replace(/,/g, '')) : null;
        const val = (num != null && !isNaN(num)) ? num : null;
        const cell = ws.getCell(rowNum, yIdx + 2);
        cell.value = val;
        cell.font = isTotal ? bbFont : bFont;
        cell.fill = rowFill;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = border4;
        if (val != null) cell.numFmt = '#,##0.0';
      });
    });
    return ws;
  }

  makeFinSheet('Income Statement', [
    ['Revenue', 'revenue'], ['Cost of Goods Sold', 'cost_of_goods_sold'],
    ['Gross Profit', 'gross_profit'], ['Operating Expenses', 'operating_expenses'],
    ['EBITDA', 'ebitda'], ['Depreciation & Amortisation', 'depreciation_amortization'],
    ['EBIT', 'ebit'], ['Interest Expense', 'interest_expense'],
    ['PBT', 'pbt'], ['Tax', 'tax'], ['Net Income', 'net_income'],
  ], 'income_statement');

  makeFinSheet('Balance Sheet', [
    ['Cash & Equivalents', 'cash_equivalents'], ['Accounts Receivable', 'accounts_receivable'],
    ['Inventory', 'inventory'], ['Total Current Assets', 'total_current_assets'],
    ['Fixed Assets (Net)', 'fixed_assets_net'], ['Intangibles & Goodwill', 'intangibles_goodwill'],
    ['Total Assets', 'total_assets'], ['Accounts Payable', 'accounts_payable'],
    ['Short-Term Debt', 'short_term_debt'], ['Total Current Liabilities', 'total_current_liabilities'],
    ['Long-Term Debt', 'long_term_debt'], ['Total Liabilities', 'total_liabilities'],
    ['Share Capital', 'share_capital'], ['Retained Earnings', 'retained_earnings'],
    ['Total Equity', 'total_equity'],
  ], 'balance_sheet');

  makeFinSheet('Cash Flow', [
    ['Cash Flow from Operations (CFO)', 'cfo'], ['Cash Flow from Investing (CFI)', 'cfi'],
    ['Cash Flow from Financing (CFF)', 'cff'], ['Capital Expenditure (Capex)', 'capex'],
    ['Free Cash Flow', 'free_cash_flow'],
  ], 'cash_flow');

  // ── Sheet 5: Financial Ratios ───────────────────────────────────────────────
  const ratioWs = wb.addWorksheet('Financial Ratios');
  ratioWs.showGridLines = false;
  ratioWs.views = [{ state: 'frozen', xSplit: 1, ySplit: 0 }];
  ratioWs.getColumn(1).width = 36;
  years.forEach((_, i) => { ratioWs.getColumn(i + 2).width = 17; });

  const ratioSections = [
    { title: 'Profitability', color: '1A6B3C', keys: ['Gross Margin %', 'EBITDA Margin %', 'EBIT Margin %', 'Net Profit Margin %', 'Return on Assets %', 'Return on Equity %', 'Return on Capital Employed %'] },
    { title: 'Liquidity',     color: '1A3A5C', keys: ['Current Ratio', 'Quick Ratio', 'Cash Ratio', 'Operating CF Ratio'] },
    { title: 'Leverage',      color: '8B1A1A', keys: ['Debt to Equity', 'Total Debt to Assets %', 'Equity Ratio %', 'Debt to EBITDA', 'Net Debt to EBITDA', 'Interest Cover (EBIT)', 'Interest Cover (EBITDA)'] },
    { title: 'Efficiency',    color: 'A87C1A', keys: ['Asset Turnover', 'Fixed Asset Turnover', 'Inventory Days', 'Receivables Days (DSO)', 'Payables Days (DPO)'] },
    { title: 'Cash Flow',     color: '1A5C4A', keys: ['FCF Margin %', 'Capex to Revenue %', 'CFO to Net Income'] },
    { title: 'Growth',        color: '0A1628', keys: ['Revenue Growth %', 'Net Income Growth %', 'EBITDA Growth %'] },
  ];

  let rRow = 1;
  ratioSections.forEach(section => {
    const secFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + section.color } };
    applyCell(ratioWs, rRow, 1, section.title, hFont, secFill, { vertical: 'middle' });
    years.forEach((yr, i) => applyCell(ratioWs, rRow, i + 2, yr, hFont, secFill, { horizontal: 'center', vertical: 'middle' }));
    ratioWs.getRow(rRow).height = 22;
    rRow++;

    section.keys.forEach((key, kIdx) => {
      const rf = kIdx % 2 === 0 ? whiteFill : lgFill;
      applyCell(ratioWs, rRow, 1, key, bFont, rf, { vertical: 'middle' });
      years.forEach((yr, yIdx) => {
        const val = ratiosByYear?.[yr]?.[key];
        applyCell(ratioWs, rRow, yIdx + 2, val ?? null, bFont, rf, { horizontal: 'center', vertical: 'middle' });
      });
      ratioWs.getRow(rRow).height = 18;
      rRow++;
    });
    rRow++;
  });

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ── Component ──────────────────────────────────────────────────────────────────

const STEPS = [
  'Extracting document text...',
  'Sending to Claude AI...',
  'Analysing financials...',
  'Building Word brief...',
  'Building Excel workbook...',
  'Downloads ready!',
];

function SpinnerSVG() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ animation: 'pa-spin 1s linear infinite' }}>
      <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeLinecap="round" strokeDasharray="31.4 31.4" transform="rotate(-90 12 12)" />
    </svg>
  );
}

function recalculateRatios(data) {
  const years = data.financial_years || []
  const result = {}
  for (const yr of years) {
    const is_ = data.income_statement || {}
    const bs_ = data.balance_sheet    || {}
    const cf_ = data.cash_flow        || {}
    const g = (s, k) => {
      const v = s[k]?.[yr]
      if (v == null) return null
      const n = parseFloat(String(v).replace(/,/g, ''))
      return isNaN(n) ? null : n
    }
    const div = (a, b) => (a != null && b != null && b !== 0) ? Math.round(a / b * 10000) / 10000 : null
    const pct = (a, b) => { const v = div(a, b); return v != null ? Math.round(v * 10000) / 100 : null }
    const rev = g(is_, 'revenue'), gp = g(is_, 'gross_profit')
    const ebitda = g(is_, 'ebitda'), ebit = g(is_, 'ebit')
    const ni = g(is_, 'net_income'), ie = g(is_, 'interest_expense')
    const ta = g(bs_, 'total_assets'), ca = g(bs_, 'total_current_assets')
    const cl = g(bs_, 'total_current_liabilities')
    const inv = g(bs_, 'inventory'), ar = g(bs_, 'accounts_receivable')
    const ap = g(bs_, 'accounts_payable'), cash = g(bs_, 'cash_equivalents')
    const eq = g(bs_, 'total_equity'), ltd = g(bs_, 'long_term_debt')
    const std = g(bs_, 'short_term_debt'), fa = g(bs_, 'fixed_assets_net')
    const cfo = g(cf_, 'cfo'), capex = g(cf_, 'capex')
    const fcf = g(cf_, 'free_cash_flow')
    const cogs = g(is_, 'cost_of_goods_sold')
    const debt = ltd != null && std != null ? ltd + std : (ltd ?? std)
    const netDebt = debt != null && cash != null ? debt - cash : null
    const r = {}
    r['Gross Margin %'] = pct(gp, rev)
    r['EBITDA Margin %'] = pct(ebitda, rev)
    r['EBIT Margin %'] = pct(ebit, rev)
    r['Net Profit Margin %'] = pct(ni, rev)
    r['Return on Assets %'] = pct(ni, ta)
    r['Return on Equity %'] = pct(ni, eq)
    r['Return on Capital Employed %'] = (ebit != null && ta != null && cl != null) ? pct(ebit, ta - cl) : null
    r['Asset Turnover'] = div(rev, ta)
    r['Current Ratio'] = div(ca, cl)
    r['Quick Ratio'] = (ca != null && inv != null) ? div(ca - inv, cl) : div(ca, cl)
    r['Cash Ratio'] = div(cash, cl)
    r['Operating CF Ratio'] = div(cfo, cl)
    r['Debt to Equity'] = div(debt, eq)
    r['Total Debt to Assets %'] = pct(debt, ta)
    r['Equity Ratio %'] = pct(eq, ta)
    r['Debt to EBITDA'] = div(debt, ebitda)
    r['Net Debt to EBITDA'] = div(netDebt, ebitda)
    r['Interest Cover (EBIT)'] = div(ebit, ie)
    r['Interest Cover (EBITDA)'] = div(ebitda, ie)
    r['Inventory Days'] = (inv != null && cogs != null) ? Math.round(div(inv, cogs) * 365 * 10) / 10 : null
    r['Receivables Days (DSO)'] = (ar != null && rev != null) ? Math.round(div(ar, rev) * 365 * 10) / 10 : null
    r['Payables Days (DPO)'] = (ap != null && cogs != null) ? Math.round(div(ap, cogs) * 365 * 10) / 10 : null
    r['Fixed Asset Turnover'] = div(rev, fa)
    r['FCF Margin %'] = pct(fcf, rev)
    r['Capex to Revenue %'] = pct(capex, rev)
    r['CFO to Net Income'] = div(cfo, ni)
    const prevYr = years[years.indexOf(yr) - 1]
    if (prevYr) {
      const gp2 = (s, k) => {
        const v = s[k]?.[prevYr]
        if (v == null) return null
        const n = parseFloat(String(v).replace(/,/g, ''))
        return isNaN(n) ? null : n
      }
      const rp = gp2(is_, 'revenue')
      const nip = gp2(is_, 'net_income')
      const ep = gp2(is_, 'ebitda')
      r['Revenue Growth %'] = (rev != null && rp != null && rp !== 0) ? Math.round((rev - rp) / Math.abs(rp) * 10000) / 100 : null
      r['Net Income Growth %'] = (ni != null && nip != null && nip !== 0) ? Math.round((ni - nip) / Math.abs(nip) * 10000) / 100 : null
      r['EBITDA Growth %'] = (ebitda != null && ep != null && ep !== 0) ? Math.round((ebitda - ep) / Math.abs(ep) * 10000) / 100 : null
    }
    result[yr] = r
  }
  return result
}

export default function PrivateAnalyzer() {
  const [stage, setStage] = useState('idle');
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState('');
  const [resultMeta, setResultMeta] = useState(null);
  const fileInputRef = useRef(null);

  const handleFile = useCallback((f) => {
    if (!f) return;
    const name = f.name.toLowerCase();
    const validTypes = ['.pdf', '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.docx', '.doc'];
    const isValid = validTypes.some(ext => name.endsWith(ext));
    if (!isValid) {
      setError('Please upload a PDF, image, or Word document.');
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      setError('File must be under 25 MB.');
      return;
    }
    setFile(f);
    setError('');
    setStage('ready');
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const process = async () => {
    if (!file) return;
    setStage('processing');
    setError('');
    setStepIdx(0);

    try {
      const arrayBuffer = await file.arrayBuffer();
      // Clone the buffer because pdfjs detaches the original
      const arrayBufferCopy = arrayBuffer.slice(0);

      // Check page count before sending — Claude document API max is 100 pages
      let requestBody;
      const fileName = file.name.toLowerCase();
      if (fileName.endsWith('.pdf')) {
        const pdfjsLib = await loadPdfJs();
        const pdf = await pdfjsLib.getDocument({ data: arrayBufferCopy }).promise;
        const totalPages = pdf.numPages;

        if (totalPages <= 100) {
          // Under limit — send as document directly
          const bytes = new Uint8Array(arrayBuffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i += 8192) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          }
          requestBody = {
            mode: 'document',
            fileBase64: btoa(binary),
            mimeType: file.type || 'application/pdf',
            fileName: file.name,
            companyName: companyName.trim() || null,
          };
        } else {
          // Over 100 pages — extract text using pdfjs on all pages
          // then send as text mode (no page limit)
          const financialKeywords = [
            'profit and loss', 'profit & loss', 'statement of profit',
            'income statement', 'statement of income', 'revenue from operations',
            'balance sheet', 'assets and liabilities', 'cash flow', 'cash flows',
            'total revenue', 'total income', 'gross profit', 'net profit',
            'net income', 'total assets', 'total liabilities', 'shareholders equity',
            'shareholders funds', 'share capital', 'retained earnings',
            'operating activities', 'investing activities', 'financing activities',
            'depreciation', 'amortisation', 'amortization', 'ebitda',
            'trade receivables', 'trade payables', 'inventories',
            'current assets', 'current liabilities', 'revenue', 'turnover'
          ];

          let extractedText = '';
          for (let i = 1; i <= totalPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str).join(' ');
            const pageTextLower = pageText.toLowerCase();
            const hasFinancial = financialKeywords.some(kw => pageTextLower.includes(kw));
            if (hasFinancial || pageText.replace(/\s/g, '').length > 100) {
              extractedText += `\n--- PAGE ${i} ---\n` + pageText;
            }
          }

          requestBody = {
            mode: 'text',
            extractedText: extractedText,
            fileName: file.name,
            companyName: companyName.trim() || null,
          };
        }
      } else {
        // Non-PDF file — convert to base64 and send as document
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        requestBody = {
          mode: 'document',
          fileBase64: btoa(binary),
          mimeType: file.type || 'application/pdf',
          fileName: file.name,
          companyName: companyName.trim() || null,
        };
      }

      setStepIdx(1);

      const res = await fetch(
        'https://api.finsightai.org/analyze',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server error: ${res.status}`);
      }

      let { analysis, ratiosByYear } = await res.json();
      if ((analysis.financial_years || []).length > 1) {
        analysis.financial_years = [...analysis.financial_years].sort((a, b) => {
          const numA = parseInt(String(a).match(/\d{4}/)?.[0] || '0');
          const numB = parseInt(String(b).match(/\d{4}/)?.[0] || '0');
          return numA - numB;
        });
      }
      const is_ = analysis.income_statement || {};
      (analysis.financial_years || []).forEach(yr => {
        const ebit = is_.ebit?.[yr];
        const ie = is_.interest_expense?.[yr];
        if (ebit != null && ie != null && is_.pbt?.[yr] != null) {
          if (Math.abs(is_.pbt[yr] - ebit) < 0.1) {
            is_.pbt[yr] = parseFloat((ebit - ie).toFixed(2));
          }
        }
      });
      ratiosByYear = recalculateRatios(analysis);
      setStepIdx(2);

      const hasSection = (data, sectionKey, keys) => {
        const section = data[sectionKey] || {};
        return keys.some(key =>
          Object.values(section[key] || {}).some(v => v !== null)
        );
      };

      const hasIncomeData = (a) => {
        const is_ = a.income_statement || {};
        const keys = ['revenue', 'net_income', 'gross_profit', 'ebitda', 'pbt', 'total_income', 'operating_profit'];
        const filled = keys.filter(k => Object.values(is_[k] || {}).some(v => v !== null));
        return filled.length >= 2;
      };

      const hasBalanceData = (a) => {
        const bs = a.balance_sheet || {};
        const keys = ['total_assets', 'total_equity', 'cash_equivalents', 'total_liabilities', 'net_worth'];
        const filled = keys.filter(k => Object.values(bs[k] || {}).some(v => v !== null));
        return filled.length >= 2;
      };

      const hasCashFlowData = (a) => {
        const cf = a.cash_flow || {};
        const keys = ['cfo', 'cfi', 'cff', 'net_cash_change'];
        const filled = keys.filter(k => Object.values(cf[k] || {}).some(v => v !== null));
        return filled.length >= 1;
      };

      const missingSections = [];
      if (!hasIncomeData(analysis)) missingSections.push('income statement, profit and loss, revenue, expenses, net profit');
      if (!hasBalanceData(analysis)) missingSections.push('balance sheet, total assets, total liabilities, equity');
      if (!hasCashFlowData(analysis)) missingSections.push('cash flow, operating activities, investing activities, financing activities');

      if (missingSections.length > 0) {
        setStepIdx(1);
        const pdfjsLib = await loadPdfJs();
        const ab = arrayBuffer.slice(0);
        const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
        const totalPages = pdf.numPages;

        let pagesToRender = Array.from({ length: totalPages }, (_, i) => i + 1);
        if (pagesToRender.length > 40) {
          const step = (pagesToRender.length - 1) / 39;
          pagesToRender = Array.from({ length: 40 }, (_, i) =>
            pagesToRender[Math.round(i * step)]
          );
        }

        const renderPage = async (pageNum) => {
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
        };

        const pageImages = [];
        for (const pageNum of pagesToRender) {
          pageImages.push(await renderPage(pageNum));
        }

        const missingHint = missingSections.join(' AND ');

        const res2 = await fetch(
          'https://api.finsightai.org/analyze',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: 'vision',
              pageImages,
              missingHint,
              fileName: file.name,
              companyName: companyName.trim() || null,
            }),
          }
        );

        if (!res2.ok) {
          const e2 = await res2.json().catch(() => ({}));
          if (e2.error && (
            e2.error.includes('content filtering') ||
            e2.error.includes('Output blocked') ||
            e2.error.includes('content_policy')
          )) {
            console.warn('Vision fallback blocked by content filter — keeping existing data');
          } else {
            throw new Error(e2.error || 'Vision fallback failed');
          }
        } else {
          const data2 = await res2.json();
          if (!hasIncomeData(analysis) && hasIncomeData(data2.analysis)) {
            analysis.income_statement = data2.analysis.income_statement;
          }
          if (!hasBalanceData(analysis) && hasBalanceData(data2.analysis)) {
            analysis.balance_sheet = data2.analysis.balance_sheet;
          }
          if (!hasCashFlowData(analysis) && hasCashFlowData(data2.analysis)) {
            analysis.cash_flow = data2.analysis.cash_flow;
          }
          ratiosByYear = recalculateRatios(analysis);
        }
      }

      setStepIdx(3);
      const wordBlob = await generateWordDoc(analysis, ratiosByYear);
      const safeName = (analysis.company_profile?.name ||
        companyName || 'PrivateCompany')
        .replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '_');

      triggerDownload(wordBlob, `${safeName}_Financial_Brief.docx`);
      await new Promise(resolve => setTimeout(resolve, 1500));

      setStepIdx(4);
      const excelBlob = await generateExcelWorkbook(analysis, ratiosByYear);
      triggerDownload(excelBlob, `${safeName}_Financial_Model.xlsx`);

      setResultMeta({
        company: analysis.company_profile?.name ||
                 companyName || 'Private Company',
        years: analysis.financial_years || [],
        wordFile: `${safeName}_Financial_Brief.docx`,
        excelFile: `${safeName}_Financial_Model.xlsx`,
        _analysis: analysis,
      });
      setStepIdx(5);
      setStage('done');

    } catch (e) {
      setError(e.message || 'Processing failed.');
      setStage('error');
    }
  };

  const reset = () => {
    setStage('idle'); setFile(null); setCompanyName('');
    setError(''); setResultMeta(null); setStepIdx(0);
  };

  if (stage === 'done' && resultMeta) {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto', background: '#fff', borderRadius: 16, padding: '40px 36px', boxShadow: '0 4px 24px rgba(10,22,40,.1)', border: '1px solid #E5E7EB', textAlign: 'center' }}>
        <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#F0FAF5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, margin: '0 auto 20px' }}>✓</div>
        <h2 style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 22, fontWeight: 800, color: NAVY, marginBottom: 8 }}>Downloads Ready</h2>
        <p style={{ color: '#6B7280', fontSize: 14, marginBottom: 24 }}>{resultMeta.company} · {resultMeta.years.join(', ')}</p>
        <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 10, padding: '14px 18px', marginBottom: 20, textAlign: 'left' }}>
          {[
            ['Income Statement', Object.values(resultMeta._analysis?.income_statement || {}).some(f => Object.values(f||{}).some(v => v != null))],
            ['Balance Sheet',    Object.values(resultMeta._analysis?.balance_sheet    || {}).some(f => Object.values(f||{}).some(v => v != null))],
            ['Cash Flow',        Object.values(resultMeta._analysis?.cash_flow        || {}).some(f => Object.values(f||{}).some(v => v != null))],
          ].map(([label, ok]) => (
            <div key={label} style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 6 }}>
              <span style={{ color: ok ? '#0D7A3E' : '#DC2626', fontWeight: 700 }}>{ok ? '✓' : '⚠'}</span>
              <span style={{ color: ok ? '#374151' : '#DC2626' }}>{label}{!ok ? ' — not extracted' : ''}</span>
            </div>
          ))}
        </div>
        <div style={{ background: '#F9FAFB', borderRadius: 10, padding: '16px 20px', marginBottom: 24, textAlign: 'left' }}>
          <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}><span style={{ marginRight: 8 }}>📄</span><strong>{resultMeta.wordFile}</strong></div>
          <div style={{ fontSize: 13, color: '#374151' }}><span style={{ marginRight: 8 }}>📊</span><strong>{resultMeta.excelFile}</strong></div>
        </div>
        <p style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 24 }}>Both files should have downloaded automatically. Check your Downloads folder.</p>
        <button onClick={reset} style={{ background: NAVY, color: '#fff', border: 'none', borderRadius: 10, padding: '12px 28px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          Analyse Another Document
        </button>
      </div>
    );
  }

  if (stage === 'processing') {
    return (
      <div style={{ maxWidth: 420, margin: '0 auto', background: '#fff', borderRadius: 16, padding: '40px 36px', boxShadow: '0 4px 24px rgba(10,22,40,.1)', border: '1px solid #E5E7EB' }}>
        <style>{`@keyframes pa-spin { to { transform: rotate(360deg); } }`}</style>
        <h2 style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 20, fontWeight: 700, color: NAVY, marginBottom: 6, textAlign: 'center' }}>Processing Document</h2>
        <p style={{ color: '#6B7280', fontSize: 13, textAlign: 'center', marginBottom: 28 }}>{file?.name}</p>
        {STEPS.map((step, i) => {
          const done = i < stepIdx, active = i === stepIdx;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, opacity: i > stepIdx ? 0.35 : 1 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: done ? GREEN : active ? ORANGE : '#E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {done && <span style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>✓</span>}
                {active && <SpinnerSVG />}
              </div>
              <span style={{ fontSize: 13.5, color: done ? GREEN : active ? NAVY : '#9CA3AF', fontWeight: active ? 600 : 400 }}>{step}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 620, margin: '0 auto' }}>
      <style>{`@keyframes pa-spin { to { transform: rotate(360deg); } }`}</style>

      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#EBF0F7', borderRadius: 20, padding: '6px 16px', marginBottom: 14 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: ORANGE, display: 'inline-block' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: NAVY, textTransform: 'uppercase', letterSpacing: '.05em' }}>Private Company</span>
        </div>
        <h2 style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 22, fontWeight: 800, color: NAVY, marginBottom: 8 }}>Upload Financial Document</h2>
        <p style={{ color: '#6B7280', fontSize: 14, lineHeight: 1.6, maxWidth: 460, margin: '0 auto' }}>
          Upload any financial document and get a Bloomberg-style Word brief + Excel model automatically.
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{ border: `2px dashed ${dragOver ? NAVY : file ? GREEN : '#CBD5E1'}`, borderRadius: 14, background: dragOver ? '#EBF0F7' : file ? '#F0FAF5' : '#FAFBFC', padding: '44px 28px', textAlign: 'center', cursor: 'pointer', transition: 'all .2s', marginBottom: 16 }}
      >
        <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif,.bmp,.docx,.doc" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
        {file ? (
          <>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: NAVY, marginBottom: 4 }}>{file.name}</div>
            <div style={{ fontSize: 12, color: '#6B7280' }}>{(file.size / 1024).toFixed(0)} KB · Click to change</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 32, marginBottom: 8 }}>☁</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: NAVY, marginBottom: 6 }}>Drop file here or click to browse</div>
            <div style={{ fontSize: 12, color: '#6B7280' }}>PDF (text or scanned), images (JPG/PNG), or Word documents up to 25 MB</div>
          </>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: NAVY, marginBottom: 6 }}>Company Name <span style={{ color: '#9CA3AF', fontWeight: 400 }}>(optional override)</span></label>
        <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)}
          placeholder="e.g. Acme Private Limited"
          style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid #E5E7EB', fontSize: 14, color: NAVY, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#DC2626' }}>
          {error}
        </div>
      )}

      <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 12, padding: '14px 18px', marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: NAVY, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>What You Get</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {['Bloomberg-style Word brief', '5-sheet Excel model', 'SWOT analysis', '30+ financial ratios', 'Income Statement', 'Balance Sheet', 'Cash Flow Statement', 'Data quality notes'].map(item => (
            <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151' }}>
              <span style={{ color: GREEN, fontWeight: 700 }}>✓</span> {item}
            </div>
          ))}
        </div>
      </div>

      <button onClick={process} disabled={!file}
        style={{ width: '100%', padding: '14px 0', borderRadius: 12, border: 'none', background: file ? NAVY : '#CBD5E1', color: '#fff', fontSize: 15, fontWeight: 700, cursor: file ? 'pointer' : 'not-allowed', fontFamily: 'inherit', transition: 'background .2s' }}>
        Generate Brief + Excel Model →
      </button>

      <p style={{ textAlign: 'center', fontSize: 11, color: '#9CA3AF', marginTop: 12, lineHeight: 1.6 }}>
        Your document is processed securely and never stored. Outputs download automatically.
      </p>
    </div>
  );
}
