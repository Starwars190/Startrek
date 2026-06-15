import express from 'express'
import cors from 'cors'
import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { adaptBRiskReport } from './lib/brisk.js'
import { instafinancials } from './lib/queues.js'
import pool, { ensureSchema } from './lib/postgres.js'
import { extractFinancials } from './core/extractFinancials.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

app.options('*', cors())

// No artificial limits — production-grade payload handling
app.use(express.json({ limit: '500mb' }))
app.use(express.urlencoded({ limit: '500mb', extended: true }))

// Generous timeouts for large documents on slow networks
app.use((req, res, next) => {
  req.setTimeout(600000)  // 10 minutes
  res.setTimeout(600000)
  next()
})

app.get('/', (req, res) => {
  res.json({ status: 'FinSight AI Analyzer — online' })
})

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    model: 'claude-sonnet-4-6',
    maxTokens: 16000,
    replica: process.env.RAILWAY_REPLICA_ID || 'single'
  })
})

// ── Claude API wrapper ────────────────────────────────────────────────────────
// Single entry point for all Anthropic calls.  Passed as a dependency to
// extractFinancials so the core module stays free of env/network concerns.

async function callClaude({ system, content, vision = false }) {
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  }
  // PDF beta header is required only for document-type content blocks
  if (!vision && Array.isArray(content) && content.some(c => c?.type === 'document')) {
    headers['anthropic-beta'] = 'pdfs-2024-09-25'
  }

  const body = { model: 'claude-sonnet-4-6', max_tokens: 16000, messages: [{ role: 'user', content }] }
  if (system) body.system = system

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 300_000) // 5 min hard cap

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
    })
    const data = await resp.json()
    if (data.error) {
      const msg = data.error.message || JSON.stringify(data.error)
      if (msg.includes('content filtering') || msg.includes('Output blocked')) {
        console.warn('[callClaude] Content filtered:', msg)
        return ''
      }
      throw new Error(msg)
    }
    return data?.content?.[0]?.text || ''
  } finally {
    clearTimeout(timer)
  }
}

function validateAnalysis(analysis) {
  const is_ = analysis.income_statement || {}
  const bs_ = analysis.balance_sheet || {}
  const years = analysis.financial_years || []
  const warnings = []
  for (const yr of years) {
    const rev = parseFloat(String(is_.revenue?.[yr] || 0).replace(/,/g,'')) || 0
    const ni = parseFloat(String(is_.net_income?.[yr] || 0).replace(/,/g,'')) || 0
    const ta = parseFloat(String(bs_.total_assets?.[yr] || 0).replace(/,/g,'')) || 0
    const te = parseFloat(String(bs_.total_equity?.[yr] || 0).replace(/,/g,'')) || 0
    const tl = parseFloat(String(bs_.total_liabilities?.[yr] || 0).replace(/,/g,'')) || 0
    if (rev < 0) warnings.push(yr + ': Revenue negative — likely extraction error')
    if (rev > 0 && Math.abs(ni) > Math.abs(rev) * 2) warnings.push(yr + ': Net income exceeds 2x revenue — likely extraction error')
    if (ta > 0 && te > 0 && tl > 0) {
      const diff = Math.abs(ta - (te + tl))
      if (diff / ta > 0.15) warnings.push(yr + ': Balance sheet gap ' + diff.toFixed(0) + ' lakhs')
    }
  }
  if (warnings.length > 0) console.warn('[validation]', warnings.join(' | '))
  return warnings
}

app.post('/analyze', async (req, res) => {
  try {
    const {
      mode, extractedText, pageImages, missingHint,
      imageBase64, imageMimeType,
      fileBase64, mimeType, fileName, companyName
    } = req.body

    const upload = { mode, fileBase64, mimeType, extractedText, pageImages, missingHint, imageBase64, imageMimeType }
    const extraction = await extractFinancials(upload, callClaude)

    // Document could not meet quality threshold — return immediately, no files generated
    if (extraction.status === 'review_required') {
      console.warn('[analyze] review_required:', extraction.reasons)
      return res.status(422).json(extraction)
    }

    // Happy path
    console.log('[analyze] coverage:', extraction.coverage)
    const analysis = extraction.raw.lineItems

    if (companyName && analysis.company_profile) analysis.company_profile.name = companyName
    console.log('[analyze] key_observations count:', analysis.key_observations?.length)
    validateAnalysis(analysis)
    const ratiosByYear = calculateRatios(analysis)
    return res.status(200).json({ success: true, analysis, ratiosByYear, mode, format: extraction.format })

  } catch (err) {
    console.error('[analyze] ERROR:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

function calculateRatios(data) {
  const years = data.financial_years || []
  const result = {}
  for (const yr of years) {
    const is_ = data.income_statement || {}
    const bs_ = data.balance_sheet    || {}
    const cf_ = data.cash_flow        || {}
    const g = (s, k) => { const v = s[k]?.[yr]; if (v == null) return null; const n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? null : n }
    const div = (a, b) => (a != null && b != null && b !== 0) ? Math.round(a / b * 10000) / 10000 : null
    const pct = (a, b) => { const v = div(a, b); return v != null ? Math.round(v * 10000) / 100 : null }
    const rev = g(is_, 'revenue'), gp = g(is_, 'gross_profit'), ebitda = g(is_, 'ebitda'), ebit = g(is_, 'ebit')
    const ni = g(is_, 'net_income'), ie = g(is_, 'interest_expense')
    const ta = g(bs_, 'total_assets'), ca = g(bs_, 'total_current_assets'), cl = g(bs_, 'total_current_liabilities')
    const inv = g(bs_, 'inventory'), ar = g(bs_, 'accounts_receivable'), ap = g(bs_, 'accounts_payable')
    const cash = g(bs_, 'cash_equivalents'), eq = g(bs_, 'total_equity')
    const ltd = g(bs_, 'long_term_debt'), std = g(bs_, 'short_term_debt'), fa = g(bs_, 'fixed_assets_net')
    const cfo = g(cf_, 'cfo'), capex = g(cf_, 'capex'), fcf = g(cf_, 'free_cash_flow')
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
    r['Inventory Days'] = (inv != null && g(is_, 'cost_of_goods_sold') != null) ? Math.round(div(inv, g(is_, 'cost_of_goods_sold')) * 365 * 10) / 10 : null
    r['Receivables Days (DSO)'] = (ar != null && rev != null) ? Math.round(div(ar, rev) * 365 * 10) / 10 : null
    r['Payables Days (DPO)'] = (ap != null && g(is_, 'cost_of_goods_sold') != null) ? Math.round(div(ap, g(is_, 'cost_of_goods_sold')) * 365 * 10) / 10 : null
    r['Fixed Asset Turnover'] = div(rev, fa)
    r['FCF Margin %'] = pct(fcf, rev)
    r['Capex to Revenue %'] = pct(capex, rev)
    r['CFO to Net Income'] = div(cfo, ni)
      // Altman Z-Score for private companies (Z' model)
      const re = g(bs_, 'retained_earnings') ?? g(bs_, 'reserves_surplus') ?? g(bs_, 'reserves_and_surplus') ?? g(bs_, 'reserves_and_surplus_balance') ?? eq
      const tl_ = g(bs_, 'total_liabilities') ?? g(bs_, 'total_liabilities_net') ?? (g(bs_, 'non_current_liabilities') != null && g(bs_, 'current_liabilities') != null ? g(bs_, 'non_current_liabilities') + g(bs_, 'current_liabilities') : null) ?? (cl != null ? cl : null) ?? (ta != null && eq != null ? ta - eq : null)
      const wc = (ca != null && cl != null) ? ca - cl : null
      if (wc != null && re != null && ebit != null && eq != null && tl_ != null && rev != null && ta != null && ta > 0 && tl_ > 0) {
        const A = wc / ta
        const B = re / ta
        const C = ebit / ta
        const D = eq / tl_
        const E = rev / ta
        const z = Math.round(((0.717 * A) + (0.847 * B) + (3.107 * C) + (0.420 * D) + (0.998 * E)) * 100) / 100
        r["Altman Z-Score"] = z
        r["Altman Zone"] = z >= 2.9 ? "Safe Zone" : z >= 1.23 ? "Grey Zone" : "Distress Zone"
      } else {
        r["Altman Z-Score"] = null
        r["Altman Zone"] = null
      }
    const prevYr = years[years.indexOf(yr) - 1]
    if (prevYr) {
      const gp2 = (s, k) => { const v = s[k]?.[prevYr]; if (v == null) return null; const n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? null : n }
      const rp = gp2(is_, 'revenue'), nip = gp2(is_, 'net_income'), ep = gp2(is_, 'ebitda')
      r['Revenue Growth %'] = (rev != null && rp != null && rp !== 0) ? Math.round((rev - rp) / Math.abs(rp) * 10000) / 100 : null
      r['Net Income Growth %'] = (ni != null && nip != null && nip !== 0) ? Math.round((ni - nip) / Math.abs(nip) * 10000) / 100 : null
      r['EBITDA Growth %'] = (ebitda != null && ep != null && ep !== 0) ? Math.round((ebitda - ep) / Math.abs(ep) * 10000) / 100 : null
    }
    result[yr] = r
  }
  return result
}

// ---------------------------------------------------------------------------
// GET /fetch-mca/:cin — check caches, then enqueue async BRisk job
// ---------------------------------------------------------------------------
const CACHE_DIR = join(__dirname, 'cache')

app.get('/fetch-mca/:cin', async (req, res) => {
  const { cin } = req.params
  if (!cin || !/^[A-Z0-9]{21}$/.test(cin)) {
    return res.status(400).json({ error: 'Invalid CIN format' })
  }
  if (!process.env.INSTAFINANCIALS_API_KEY) {
    return res.status(500).json({ error: 'INSTAFINANCIALS_API_KEY not configured on server' })
  }

  // 1. File cache hit — adapt inline and return immediately (no queue needed)
  const cachePath = join(CACHE_DIR, `brisk_${cin}.json`)
  if (existsSync(cachePath)) {
    try {
      const adapted = adaptBRiskReport(JSON.parse(readFileSync(cachePath, 'utf8')))
      return res.json(adapted)
    } catch (err) {
      console.warn(`[fetch-mca] cache read failed for ${cin}:`, err.message)
    }
  }

  // 2. Postgres completed-report hit
  try {
    const { rows } = await pool.query(
      'SELECT adapted_data FROM brisk_reports WHERE cin = $1 AND status = $2',
      [cin, 'complete']
    )
    if (rows.length > 0 && rows[0].adapted_data) {
      return res.json(rows[0].adapted_data)
    }
  } catch (err) {
    console.warn('[fetch-mca] Postgres check failed:', err.message)
  }

  // 3. Enqueue — jobId deduplicates so double-clicks collapse to one job
  if (!instafinancials) {
    return res.status(503).json({ error: 'Queue unavailable — Redis not connected' })
  }
  try {
    const job = await instafinancials.add('fetch-brisk', { cin }, { jobId: `brisk:${cin}` })
    return res.status(202).json({ jobId: job.id, status: 'queued' })
  } catch (err) {
    console.error('[fetch-mca] enqueue failed:', err.message)
    return res.status(503).json({ error: 'Queue unavailable' })
  }
})

// ---------------------------------------------------------------------------
// GET /jobs/:id — poll job state; returns result payload when complete
// ---------------------------------------------------------------------------
app.get('/jobs/:id', async (req, res) => {
  if (!instafinancials) return res.status(503).json({ error: 'Queue unavailable — Redis not connected' })
  try {
    const job = await instafinancials.getJob(req.params.id)
    if (!job) return res.status(404).json({ error: 'Job not found' })
    const state = await job.getState()
    const response = { id: job.id, state, progress: job.progress }
    if (state === 'completed') response.result    = job.returnvalue
    if (state === 'failed')    response.failedReason = job.failedReason
    return res.json(response)
  } catch (err) {
    console.error('[jobs] getJob failed:', err.message)
    return res.status(503).json({ error: 'Queue unavailable' })
  }
})

ensureSchema().catch(err => console.error('[postgres] schema error:', err.message))

const server = app.listen(process.env.PORT || 3001, '0.0.0.0', () => {
  console.log(`Server running on port ${process.env.PORT || 3001}`)
})

// Production-grade server timeouts
server.timeout = 600000           // 10 minutes
server.keepAliveTimeout = 600000  // 10 minutes
server.headersTimeout = 605000    // 10 minutes 5 seconds
