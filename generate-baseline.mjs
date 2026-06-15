/**
 * generate-baseline.mjs
 *
 * End-to-end baseline capture for /baseline/ directory:
 *   1. Start railway-server (or reuse)
 *   2. POST Lake Chemicals PDF → /analyze (document mode)
 *   3. Save raw analysis JSON
 *   4. Generate CMA workbook via CMAGenerator.js
 *   5. Generate a structured Word doc via docx npm package
 *   6. Write all outputs to ./baseline/
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname }  from 'path'
import { fileURLToPath }     from 'url'
import { spawn }             from 'child_process'
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
         BorderStyle, AlignmentType, WidthType, HeadingLevel, ShadingType }
  from 'docx'
import { generateCMAWorkbook } from './src/CMAGenerator.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── env ──────────────────────────────────────────────────────────────────────
const envPath = resolve(__dirname, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim()
    if (!(k in process.env)) process.env[k] = v
  }
}

const PORT    = 3001
const BASE    = `http://localhost:${PORT}`
const PDF_SRC = 'C:/Users/hitan/Downloads/579087456_LAKE CHEMICALS-FINANCIALS 2024-25 (1).pdf'
const OUT_DIR = resolve(__dirname, 'baseline')

// ── helpers ───────────────────────────────────────────────────────────────────
async function checkHealth() {
  try { const r = await fetch(`${BASE}/health`); return r.ok } catch { return false }
}
async function waitForServer(ms = 25000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await checkHealth()) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

// ── Word helpers ──────────────────────────────────────────────────────────────
const NAVY  = '1F3A5F'
const GOLD  = 'B7860F'
const WHITE = 'FFFFFF'
const DK    = '222222'
const LIGHT = 'F2F4F7'

const txt = (text, opts = {}) => new TextRun({
  text: String(text ?? '—'),
  font: 'Calibri',
  size: opts.size || 22,
  bold: opts.bold || false,
  color: opts.color || DK,
})

const heading = (text, lvl = 1) => new Paragraph({
  children: [txt(text, { size: lvl === 1 ? 32 : 24, bold: true, color: NAVY })],
  spacing: { before: 300, after: 120 },
  heading: lvl === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
})

const para = (text, opts = {}) => new Paragraph({
  children: [txt(text, opts)],
  spacing: { after: 120 },
})

const noBorder = { style: BorderStyle.NONE, size: 0, color: WHITE }
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }

const cell = (text, opts = {}) => new TableCell({
  children: [new Paragraph({
    children: [txt(text, { bold: opts.bold, size: opts.size || 20, color: opts.color || DK })],
    alignment: opts.align || AlignmentType.LEFT,
  })],
  shading: opts.bg ? { fill: opts.bg, type: ShadingType.SOLID } : undefined,
  borders: opts.borders || noBorders,
  width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
})

function kv2Row(label, value) {
  return new TableRow({ children: [
    cell(label, { bold: true, bg: LIGHT, width: 40 }),
    cell(value ?? '—', { width: 60 }),
  ]})
}

function thinBorder() {
  const s = { style: BorderStyle.SINGLE, size: 4, color: 'D0D5DD' }
  return { top: s, bottom: s, left: s, right: s }
}

function headerCell(text) {
  return cell(text, { bold: true, bg: NAVY, color: WHITE, borders: { top: thinBorder().top, bottom: thinBorder().bottom, left: thinBorder().left, right: thinBorder().right }, align: AlignmentType.CENTER, size: 18 })
}

function dataCell(text, bold = false) {
  return cell(text, { bold, size: 19, align: AlignmentType.RIGHT })
}

// ── main ──────────────────────────────────────────────────────────────────────
let serverProc = null
try {
  // 1. Server
  const already = await checkHealth()
  if (!already) {
    console.log('Starting railway-server on port 3001…')
    serverProc = spawn('node', ['server.js'], {
      cwd:   resolve(__dirname, 'railway-server'),
      env:   { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    serverProc.stdout.on('data', d => process.stdout.write('[server] ' + d))
    serverProc.stderr.on('data', d => process.stderr.write('[server] ' + d))
    const ready = await waitForServer()
    if (!ready) throw new Error('Server failed to become healthy within 25 s')
    console.log('Server ready.\n')
  } else {
    console.log('Server already running.\n')
  }

  // 2. POST PDF → /analyze
  console.log(`Reading PDF: ${PDF_SRC}`)
  const pdfBuf = readFileSync(PDF_SRC)
  const fileBase64 = pdfBuf.toString('base64')
  console.log(`PDF size: ${(pdfBuf.length / 1024).toFixed(0)} KB — POSTing to /analyze (document mode)…`)

  const analyzeResp = await fetch(`${BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'document',
      fileBase64,
      mimeType: 'application/pdf',
      fileName: 'LAKE CHEMICALS-FINANCIALS 2024-25.pdf',
      companyName: 'Lake Chemicals Private Limited',
    }),
  })

  if (!analyzeResp.ok) {
    const err = await analyzeResp.json().catch(() => ({}))
    throw new Error(`/analyze returned ${analyzeResp.status}: ${JSON.stringify(err)}`)
  }

  const { analysis, ratiosByYear } = await analyzeResp.json()
  console.log('Analysis received.')
  console.log('  Company:', analysis?.company_profile?.name)
  console.log('  Years:  ', (analysis?.financial_years || []).join(', '))

  // 3. Ensure /baseline/ exists
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

  // 4. Save analysis JSON
  const jsonPath = resolve(OUT_DIR, 'Lake_Chemicals_analysis.json')
  writeFileSync(jsonPath, JSON.stringify({ analysis, ratiosByYear }, null, 2), 'utf8')
  console.log(`\nSaved: ${jsonPath}`)

  // 5. Generate CMA Excel
  console.log('Generating CMA workbook…')
  const cmaWb = await generateCMAWorkbook(analysis, ratiosByYear, {}, {})
  const cmaPath = resolve(OUT_DIR, 'Lake_Chemicals_CMA.xlsx')
  await cmaWb.xlsx.writeFile(cmaPath)
  console.log(`Saved: ${cmaPath}`)

  // 6. Generate Word doc
  console.log('Generating Word doc…')
  const co    = analysis.company_profile || {}
  const years = analysis.financial_years || []
  const is_   = analysis.income_statement || {}
  const bs_   = analysis.balance_sheet    || {}

  const g = (sec, k, yr) => {
    const v = sec?.[k]?.[yr]
    if (v == null) return '—'
    const n = parseFloat(String(v).replace(/,/g, ''))
    return isNaN(n) ? String(v) : n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
  }

  // Financial summary table rows
  const metrics = [
    { label: 'Revenue', key: 'revenue', sec: is_ },
    { label: 'EBITDA',  key: 'ebitda',  sec: is_ },
    { label: 'EBIT',    key: 'ebit',    sec: is_ },
    { label: 'PAT',     key: 'net_profit', sec: is_ },
    { label: 'Total Assets', key: 'total_assets', sec: bs_ },
    { label: 'Total Equity', key: 'total_equity', sec: bs_ },
    { label: 'Total Debt',   key: 'total_debt',   sec: bs_ },
  ]

  const finRows = [
    new TableRow({ children: [
      headerCell('Metric'),
      ...years.map(yr => headerCell(yr)),
    ]}),
    ...metrics.map(({ label, key, sec }) => new TableRow({ children: [
      cell(label, { bold: true, size: 19 }),
      ...years.map(yr => dataCell(g(sec, key, yr))),
    ]})),
  ]

  // Ratio rows
  const ratioMetrics = [
    { label: 'Current Ratio',   field: 'current_ratio' },
    { label: 'Debt/Equity',     field: 'debt_to_equity' },
    { label: 'EBITDA Margin %', field: 'ebitda_margin' },
    { label: 'PAT Margin %',    field: 'net_profit_margin' },
    { label: 'Interest Cover',  field: 'interest_coverage' },
    { label: 'Altman Z-Score',  field: 'altman_z_score' },
  ]
  const ratioRows = [
    new TableRow({ children: [
      headerCell('Ratio'),
      ...years.map(yr => headerCell(yr)),
    ]}),
    ...ratioMetrics.map(({ label, field }) => new TableRow({ children: [
      cell(label, { bold: true, size: 19 }),
      ...years.map(yr => {
        const v = ratiosByYear?.[yr]?.[field]
        return dataCell(v != null ? Number(v).toFixed(2) : '—')
      }),
    ]})),
  ]

  // Key observations
  const obs = (analysis.key_observations || []).slice(0, 10)

  const sections = [
    heading('Financial Analysis — Baseline', 1),
    para(`Generated: ${new Date().toISOString().slice(0, 10)}`, { color: '888888' }),

    heading('Company Profile', 2),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        kv2Row('Company Name', co.name),
        kv2Row('CIN',          co.cin || co.registration_number),
        kv2Row('Industry',     co.industry),
        kv2Row('Analysis Period', co.period),
        kv2Row('Currency / Unit', `${co.currency || 'INR'} (${co.rounding || 'Lakhs'})`),
      ],
    }),

    heading('Income Statement & Balance Sheet', 2),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: finRows,
    }),

    heading('Key Ratios', 2),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: ratioRows,
    }),

    ...(obs.length ? [
      heading('Key Observations', 2),
      ...obs.map((o, i) => para(`${i + 1}. ${o}`, { size: 20 })),
    ] : []),

    ...(analysis.swot ? [
      heading('SWOT Analysis', 2),
      para('Strengths', { bold: true }),
      ...(analysis.swot.strengths || []).map(s => para(`• ${s}`)),
      para('Weaknesses', { bold: true }),
      ...(analysis.swot.weaknesses || []).map(s => para(`• ${s}`)),
      para('Opportunities', { bold: true }),
      ...(analysis.swot.opportunities || []).map(s => para(`• ${s}`)),
      para('Threats', { bold: true }),
      ...(analysis.swot.threats || []).map(s => para(`• ${s}`)),
    ] : []),
  ]

  const doc = new Document({
    sections: [{ children: sections }],
    creator: 'FinSight AI — Baseline Script',
  })

  const wordBuf = await Packer.toBuffer(doc)
  const wordPath = resolve(OUT_DIR, 'Lake_Chemicals_Brief.docx')
  writeFileSync(wordPath, wordBuf)
  console.log(`Saved: ${wordPath}`)

  console.log('\nBaseline generation complete.')
  console.log(`Output directory: ${OUT_DIR}`)
  console.log('Files:')
  console.log('  Lake_Chemicals_analysis.json')
  console.log('  Lake_Chemicals_CMA.xlsx')
  console.log('  Lake_Chemicals_Brief.docx')

} catch (err) {
  console.error('\nERROR:', err.message)
  process.exit(1)
} finally {
  if (serverProc) {
    serverProc.kill()
    console.log('\nServer process stopped.')
  }
}
