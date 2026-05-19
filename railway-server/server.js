import express from 'express'
import cors from 'cors'

const app = express()

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

app.options('*', cors())
app.use(express.json({ limit: '50mb' }))

app.get('/', (req, res) => {
  res.json({ status: 'FinSight AI Analyzer — online' })
})

const SYSTEM_PROMPT = `You are a financial data extraction API. You output ONLY raw JSON.
No prose. No markdown. No code fences. No explanation before or after.
Start your response with { and end with }
Never guess or fabricate numbers. If you cannot find a value output null.

EXTRACTION RULES — APPLY TO EVERY DOCUMENT:

REVENUE: Look for any of these labels and use the total figure:
"Total revenue from operations", "Revenue from operations",
"Total revenue", "Net revenue", "Turnover", "Net sales",
"Revenue from sale of products", "Total income from operations",
"Gross revenue", "Sales". Use the largest top-line figure found.

COGS: Indian companies never have a single COGS line.
Sum ALL of these lines you find to get COGS:
- Cost of materials consumed
- Purchases of stock-in-trade
- Changes in inventories of finished goods / work-in-progress / stock-in-trade
If only one or two of these exist, sum whichever are present.

TAX: Sum ALL tax lines to get total tax:
- Current tax
- Deferred tax (credit)
- Income tax expense
Add them together as the total tax figure.

EBITDA: If not explicitly labelled, calculate as:
Profit before tax + Finance costs + Depreciation + Amortisation

EBIT: If not explicitly labelled, calculate as:
Profit before tax + Finance costs

GROSS PROFIT: If not explicitly labelled, calculate as:
Revenue minus COGS

OPERATING EXPENSES: Everything between Gross Profit and EBITDA.
Include employee costs, other expenses, CSR. Exclude depreciation and finance costs.

FISCAL YEARS: Use the actual year-end dates found in the document.
Format as FY2025, FY2024 etc based on the year the period ends.
Indian companies end fiscal year on 31 March — period ending 31/03/2025 = FY2025.`

const JSON_TEMPLATE = `Analyze this financial document. Return ONLY valid JSON.
Replace FY2025/FY2024 keys with the actual fiscal years found in the document.

{
  "company_profile": {
    "name": null, "industry": null, "sub_industry": null,
    "headquarters": null, "year_founded": null, "legal_structure": null,
    "reporting_currency": "INR", "reporting_unit": "INR Lakhs",
    "fiscal_year_end": null, "auditor": null,
    "description": "2-3 sentences from document only",
    "key_products_services": [], "number_of_employees": null,
    "geographic_presence": []
  },
  "financial_years": ["FY2025", "FY2024"],
  "income_statement": {
    "revenue":                   {"FY2025": null, "FY2024": null},
    "cost_of_goods_sold":        {"FY2025": null, "FY2024": null},
    "gross_profit":              {"FY2025": null, "FY2024": null},
    "operating_expenses":        {"FY2025": null, "FY2024": null},
    "ebitda":                    {"FY2025": null, "FY2024": null},
    "depreciation_amortization": {"FY2025": null, "FY2024": null},
    "ebit":                      {"FY2025": null, "FY2024": null},
    "interest_expense":          {"FY2025": null, "FY2024": null},
    "pbt":                       {"FY2025": null, "FY2024": null},
    "tax":                       {"FY2025": null, "FY2024": null},
    "net_income":                {"FY2025": null, "FY2024": null}
  },
  "balance_sheet": {
    "cash_equivalents":          {"FY2025": null, "FY2024": null},
    "accounts_receivable":       {"FY2025": null, "FY2024": null},
    "inventory":                 {"FY2025": null, "FY2024": null},
    "total_current_assets":      {"FY2025": null, "FY2024": null},
    "fixed_assets_net":          {"FY2025": null, "FY2024": null},
    "intangibles_goodwill":      {"FY2025": null, "FY2024": null},
    "total_assets":              {"FY2025": null, "FY2024": null},
    "accounts_payable":          {"FY2025": null, "FY2024": null},
    "short_term_debt":           {"FY2025": null, "FY2024": null},
    "total_current_liabilities": {"FY2025": null, "FY2024": null},
    "long_term_debt":            {"FY2025": null, "FY2024": null},
    "total_liabilities":         {"FY2025": null, "FY2024": null},
    "share_capital":             {"FY2025": null, "FY2024": null},
    "retained_earnings":         {"FY2025": null, "FY2024": null},
    "total_equity":              {"FY2025": null, "FY2024": null}
  },
  "cash_flow": {
    "cfo":            {"FY2025": null, "FY2024": null},
    "cfi":            {"FY2025": null, "FY2024": null},
    "cff":            {"FY2025": null, "FY2024": null},
    "capex":          {"FY2025": null, "FY2024": null},
    "free_cash_flow": {"FY2025": null, "FY2024": null}
  },
  "swot": {
    "strengths":     ["4-6 evidence-based points"],
    "weaknesses":    ["4-6 evidence-based points"],
    "opportunities": ["4-6 evidence-based points"],
    "threats":       ["4-6 evidence-based points"]
  },
  "key_observations": ["5-8 data-driven observations"],
  "data_quality_notes": ["any gaps or assumptions"]
}`

const parseJSON = (text) => {
  let cleaned = text.replace(/^```(?:json)?\s*/gm, '').replace(/```\s*$/gm, '').trim()
  try { return JSON.parse(cleaned) } catch (e1) {}
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const jsonStr = cleaned.substring(firstBrace, lastBrace + 1)
    try { return JSON.parse(jsonStr) } catch (e2) {}
    let fixed = jsonStr
    fixed += ']'.repeat(Math.max(0, (fixed.match(/\[/g)||[]).length - (fixed.match(/\]/g)||[]).length))
    fixed += '}'.repeat(Math.max(0, (fixed.match(/\{/g)||[]).length - (fixed.match(/\}/g)||[]).length))
    try { return JSON.parse(fixed) } catch (e4) {}
  }
  throw new Error('Could not parse JSON. Preview: ' + text.substring(0, 200))
}

app.post('/analyze', async (req, res) => {
  try {
    const {
      mode, extractedText, pageImages, missingHint,
      imageBase64, imageMimeType,
      fileBase64, mimeType, fileName, companyName
    } = req.body

    let documentText = ''

    // ── TEXT MODE ──────────────────────────────────────────────
    if (mode === 'text') {
      documentText = extractedText || ''

    // ── VISION MODE ────────────────────────────────────────────
    } else if (mode === 'vision') {
      const safeImages = (pageImages || []).slice(0, 20)
      const BATCH_SIZE = 20
      const batches = []
      for (let i = 0; i < safeImages.length; i += BATCH_SIZE) {
        batches.push(safeImages.slice(i, i + BATCH_SIZE))
      }
      console.log(`[vision] Pages: ${safeImages.length} | Batches: ${batches.length}`)

      const allText = []
      for (let b = 0; b < batches.length; b++) {
        const batch = batches[b]
        const content = []
        for (let i = 0; i < batch.length; i++) {
          content.push({ type: 'text', text: `Page ${b * BATCH_SIZE + i + 1}:` })
          content.push({
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: batch[i] }
          })
        }
        content.push({
          type: 'text',
          text: `Extract ALL text from these financial document pages exactly as it appears.
Include every number, table, label, and footnote.
Preserve table structure using | as column separator.
${missingHint ? 'IMPORTANT — focus on finding: ' + missingHint : ''}
Output raw extracted text only. Do not summarise.`
        })

        const ocrResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-opus-4-5',
            max_tokens: 8192,
            messages: [{ role: 'user', content }]
          })
        })
        const ocrData = await ocrResp.json()
        if (ocrData.error) {
          const msg = ocrData.error.message || ''
          if (msg.includes('content filtering') || msg.includes('Output blocked')) {
            console.warn('[vision] Batch blocked by content filter — skipping')
            continue
          }
          throw new Error('OCR error: ' + msg)
        }
        const txt = ocrData?.content?.[0]?.text || ''
        if (txt) allText.push(txt)
      }
      documentText = allText.join('\n\n')

    // ── IMAGE MODE ─────────────────────────────────────────────
    } else if (mode === 'image') {
      const imgResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-opus-4-5',
          max_tokens: 8192,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: imageMimeType || 'image/jpeg', data: imageBase64 }
              },
              { type: 'text', text: 'Extract ALL text from this financial document image exactly as it appears. Include every number, table, label and footnote. Output raw text only.' }
            ]
          }]
        })
      })
      const imgData = await imgResp.json()
      documentText = imgData?.content?.[0]?.text || ''

    // ── DOCUMENT MODE ──────────────────────────────────────────
    } else if (mode === 'document') {
      const docResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'pdfs-2024-09-25'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 8000,
          system: SYSTEM_PROMPT,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: mimeType || 'application/pdf',
                  data: fileBase64
                }
              },
              { type: 'text', text: JSON_TEMPLATE }
            ]
          }]
        })
      })

      const docData = await docResp.json()
      if (docData.error) throw new Error('Document API error: ' + docData.error.message)
      const rawJson = docData?.content?.[0]?.text || ''
      console.log('[document] Response length:', rawJson.length)
      console.log('[document] Preview:', rawJson.substring(0, 300))
      if (!rawJson || rawJson.length < 50) throw new Error('Claude returned empty response.')

      let analysis
      try { analysis = parseJSON(rawJson) } catch (e) {
        console.error('[document] Parse error:', e.message)
        return res.status(500).json({ error: 'Analysis failed — document may be too complex.', debug: rawJson.substring(0, 300) })
      }

      if (companyName && analysis.company_profile) analysis.company_profile.name = companyName
      const ratiosByYear = calculateRatios(analysis)
      return res.status(200).json({ success: true, analysis, ratiosByYear, mode })

    } else {
      return res.status(400).json({ error: 'Invalid mode.' })
    }

    // ── SHARED: analyse extracted text (text / vision / image modes) ──
    if (!documentText || documentText.replace(/\s/g, '').length < 200) {
      return res.status(422).json({
        error: 'Could not extract text from document. Please ensure the PDF is not password-protected.'
      })
    }

    console.log('[analyze] Text length:', documentText.length, '| Mode:', mode)

    const analysisResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: JSON_TEMPLATE + '\n\nDOCUMENT TEXT:\n' + documentText
        }]
      })
    })

    const analysisData = await analysisResp.json()
    if (analysisData?.error) throw new Error('Claude API error: ' + (analysisData.error.message || JSON.stringify(analysisData.error)))

    const rawJson = analysisData?.content?.[0]?.text || ''
    console.log('[analyze] Response length:', rawJson.length)
    console.log('[analyze] Preview:', rawJson.substring(0, 300))
    if (!rawJson || rawJson.length < 50) throw new Error('Claude returned empty response.')

    let analysis
    try { analysis = parseJSON(rawJson) } catch (e) {
      console.error('[analyze] Parse error:', e.message)
      return res.status(500).json({ error: 'Analysis failed — document may be too complex.', debug: rawJson.substring(0, 300) })
    }

    if (companyName && analysis.company_profile) analysis.company_profile.name = companyName
    const ratiosByYear = calculateRatios(analysis)
    return res.status(200).json({ success: true, analysis, ratiosByYear, textLength: documentText.length, mode })

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

app.listen(process.env.PORT || 3001, '0.0.0.0', () => {
  console.log(`Server running on port ${process.env.PORT || 3001}`)
})
