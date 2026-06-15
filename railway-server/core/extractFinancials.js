/**
 * extractFinancials.js
 *
 * Two responsibilities:
 *   1. Typed field accessors (getField, resolveAliases, …) used by deriveMetrics
 *      and the unit-test suite — unchanged from the original.
 *   2. Schema-enforced extraction entry point:
 *        extractFinancials(upload, callClaude)
 *      Handles every upload mode (document / vision / image / text), retries once
 *      on parse failure, and returns either { status:'ok', coverage, raw } or
 *      { status:'review_required', format, reasons, partial }.
 */

import { toNum } from './normalize.js'
import { RETAINED_EARNINGS_ALIASES } from './extractionSchema.js'

// ── Accessor helpers (unchanged) ─────────────────────────────────────────────

export function getField(section, key, year) {
  return toNum(section?.[key]?.[year])
}

export function resolveAliases(section, aliases, year) {
  for (const alias of aliases) {
    const v = toNum(section?.[alias]?.[year])
    if (v != null) return v
  }
  return null
}

export function getRetainedEarnings(bs, year, equityFallback = null) {
  const v = resolveAliases(bs, RETAINED_EARNINGS_ALIASES, year)
  return v ?? equityFallback
}

export function getTotalLiabilities(bs, year, cl = null, ta = null, eq = null) {
  const tl = toNum(bs?.total_liabilities?.[year]) ?? toNum(bs?.total_liabilities_net?.[year])
  if (tl != null) return tl
  const ncl = toNum(bs?.non_current_liabilities?.[year])
  const cl2 = toNum(bs?.current_liabilities?.[year])
  if (ncl != null && cl2 != null) return ncl + cl2
  if (cl != null) return cl
  if (ta != null && eq != null) return ta - eq
  return null
}

// ── Extraction prompts ────────────────────────────────────────────────────────

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
Indian companies end fiscal year on 31 March — period ending 31/03/2025 = FY2025.

KEY OBSERVATIONS: You MUST always generate exactly 6-8 specific bullet points. Each bullet must contain exact INR figures, exact percentages, and year references pulled directly from the document. Examples: revenue grew 12.6% from INR 65,426 lakhs to INR 73,698 lakhs, net loss of INR 1,680 lakhs vs profit of INR 1,469 lakhs prior year. Never leave this empty. This is mandatory.

DATA QUALITY NOTES: You MUST always generate at least 3 specific notes explaining exactly how key figures were calculated, what was included or excluded in COGS, how EBITDA was derived, any limitations in the data, and which pages or notes were used as sources. Never leave this empty. This is mandatory.

CRITICAL MANDATORY REQUIREMENT: You must always populate key_observations with exactly 6 to 8 strings. Each string must contain specific numbers, percentages, and INR figures extracted directly from the document. Do not return an empty array. Do not return placeholder text. Return real observations like: Revenue grew 12.64% from INR 65426 lakhs in FY2024 to INR 73698 lakhs in FY2025. You must also always populate data_quality_notes with at least 3 strings explaining how COGS was calculated, how EBITDA was derived, and any data limitations. Returning empty arrays for these fields is a critical failure.

The key_observations array is SEPARATE from the SWOT analysis. Do not put observations only in SWOT. The key_observations array must contain 6-8 standalone bullet point strings that summarize the most important financial findings - revenue trends, profit changes, margin movements, debt levels, cash flow highlights. These must appear in key_observations regardless of what is in the SWOT section.`

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
  "key_observations": ["MANDATORY: write 6-8 observations here with exact INR figures and % from the document - e.g. Revenue declined 4.23% from INR 9641 lakhs in FY2024 to INR 9234 lakhs in FY2025", "add more observations here", "add more observations here"],
  "data_quality_notes": ["COGS calculated as: [list exact line items summed with values]", "EBITDA derived as: PBT + Finance Costs + Depreciation = [show actual calculation]", "Data limitations: [list any missing data, assumptions made, or pages not available]"]
}`

const OCR_INSTRUCTION = `Extract ALL text from these financial document pages exactly as it appears.
Include every number, table, label, and footnote.
Preserve table structure using | as column separator.
Output raw extracted text only. Do not summarise.`

// ── Internal helpers ──────────────────────────────────────────────────────────

function parseJSON(text) {
  let cleaned = text.replace(/^```(?:json)?\s*/gm, '').replace(/```\s*$/gm, '').trim()
  try { return JSON.parse(cleaned) } catch {}
  const firstBrace = cleaned.indexOf('{')
  const lastBrace  = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const jsonStr = cleaned.substring(firstBrace, lastBrace + 1)
    try { return JSON.parse(jsonStr) } catch {}
    let fixed = jsonStr
    fixed += ']'.repeat(Math.max(0, (fixed.match(/\[/g)||[]).length - (fixed.match(/\]/g)||[]).length))
    fixed += '}'.repeat(Math.max(0, (fixed.match(/\{/g)||[]).length - (fixed.match(/\}/g)||[]).length))
    try { return JSON.parse(fixed) } catch {}
  }
  throw new Error('Could not parse JSON. Preview: ' + text.substring(0, 200))
}

// Fields checked when computing coverage (critical subset only)
const COVERAGE_FIELDS = {
  income_statement: ['revenue', 'cost_of_goods_sold', 'gross_profit', 'ebitda', 'ebit', 'net_income', 'interest_expense', 'pbt', 'tax'],
  balance_sheet:    ['total_assets', 'total_equity', 'total_liabilities', 'total_current_assets', 'total_current_liabilities', 'long_term_debt', 'short_term_debt'],
  cash_flow:        ['cfo', 'cfi', 'cff'],
}

function measureCoverage(analysis) {
  const years = analysis?.financial_years || []
  if (!years.length) {
    return { score: 0, nonNull: 0, total: 0, nullFields: [], reasons: ['No financial years detected in document'] }
  }

  let total = 0, nonNull = 0
  const nullFields = []

  for (const [sec, fields] of Object.entries(COVERAGE_FIELDS)) {
    for (const field of fields) {
      for (const yr of years) {
        total++
        const raw = analysis[sec]?.[field]?.[yr]
        const n   = parseFloat(String(raw ?? '').replace(/,/g, ''))
        if (raw != null && !isNaN(n)) nonNull++
        else nullFields.push(`${sec}.${field}[${yr}]`)
      }
    }
  }

  const score   = total > 0 ? nonNull / total : 0
  const reasons = []

  // Both revenue AND total_assets null across ALL years → not a financial document
  const allCriticalNull = years.every(yr =>
    analysis.income_statement?.revenue?.[yr]  == null &&
    analysis.balance_sheet?.total_assets?.[yr] == null
  )
  if (allCriticalNull) {
    reasons.push('Revenue and total assets are null for every year — document does not appear to be a financial statement')
  }
  if (score < 0.20) {
    reasons.push(`Coverage ${Math.round(score * 100)}% — fewer than 20% of financial fields could be extracted`)
  }

  return {
    score:     Math.round(score * 1000) / 10,   // e.g. 72.4 (%)
    nonNull,
    total,
    nullFields: nullFields.slice(0, 15),
    reasons,
  }
}

// ── Main extraction entry point ───────────────────────────────────────────────

/**
 * Extract financials from any upload mode.
 *
 * @param {Object}   upload      Payload fields from req.body
 * @param {Function} callClaude  Wrapper: ({ system, content, vision }) → string
 * @returns {{ status:'ok', format, coverage, raw:{ lineItems } }
 *          |{ status:'review_required', format, reasons, partial }}
 */
export async function extractFinancials(upload, callClaude) {
  const {
    mode,
    fileBase64, mimeType,
    extractedText,
    pageImages, missingHint,
    imageBase64, imageMimeType,
  } = upload

  let content
  let format
  let documentText = ''

  // ── Phase 1: build content for the analysis call ──────────────────────────

  if (mode === 'document' && fileBase64) {
    // Direct PDF analysis via Anthropic document API
    format  = 'pdf_document'
    content = [
      { type: 'document', source: { type: 'base64', media_type: mimeType || 'application/pdf', data: fileBase64 } },
      { type: 'text', text: JSON_TEMPLATE },
    ]

  } else if (mode === 'vision' && pageImages?.length) {
    // Multi-page image OCR → text → analysis
    format = 'vision_images'
    const safeImages = pageImages.slice(0, 40)
    const BATCH = 20
    const allText = []

    for (let b = 0; b * BATCH < safeImages.length; b++) {
      const batch      = safeImages.slice(b * BATCH, (b + 1) * BATCH)
      const ocrContent = []
      for (let i = 0; i < batch.length; i++) {
        ocrContent.push({ type: 'text', text: `Page ${b * BATCH + i + 1}:` })
        ocrContent.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: batch[i] } })
      }
      ocrContent.push({
        type: 'text',
        text: OCR_INSTRUCTION + (missingHint ? `\nIMPORTANT — focus on finding: ${missingHint}` : ''),
      })

      try {
        const txt = await callClaude({ content: ocrContent, vision: true })
        if (txt) allText.push(txt)
      } catch (err) {
        console.warn(`[extractFinancials] OCR batch ${b + 1} failed: ${err.message}`)
      }
    }

    documentText = allText.join('\n\n')
    if (!documentText || documentText.replace(/\s/g, '').length < 200) {
      documentText = 'Extract all financial data from the provided images.'
    }
    content = 'DOCUMENT TEXT:\n' + documentText + '\n\n' + JSON_TEMPLATE

  } else if (mode === 'image' && imageBase64) {
    // Single-image OCR → text → analysis
    format = 'single_image'
    const ocrContent = [
      { type: 'image', source: { type: 'base64', media_type: imageMimeType || 'image/jpeg', data: imageBase64 } },
      { type: 'text', text: 'Extract ALL text from this financial document image exactly as it appears. Include every number, table, label and footnote. Output raw text only.' },
    ]

    try {
      documentText = await callClaude({ content: ocrContent, vision: true })
    } catch (err) {
      console.warn('[extractFinancials] Image OCR failed:', err.message)
    }
    if (!documentText || documentText.replace(/\s/g, '').length < 200) {
      documentText = 'Extract all financial data from the provided images.'
    }
    content = 'DOCUMENT TEXT:\n' + documentText + '\n\n' + JSON_TEMPLATE

  } else {
    // Plain text
    format       = 'text'
    documentText = extractedText || ''
    if (!documentText || documentText.replace(/\s/g, '').length < 200) {
      return {
        status:  'review_required',
        format,
        reasons: ['Document text is too short or empty — nothing to extract'],
        partial: null,
      }
    }
    content = 'DOCUMENT TEXT:\n' + documentText + '\n\n' + JSON_TEMPLATE
  }

  // ── Phase 2: call Claude for financial analysis (retry once on failure) ────

  let analysis = null

  for (let attempt = 1; attempt <= 2; attempt++) {
    let rawJson = ''

    try {
      rawJson = await callClaude({ system: SYSTEM_PROMPT, content })
    } catch (err) {
      if (attempt === 2) {
        return { status: 'review_required', format, reasons: [`Claude API error: ${err.message}`], partial: null }
      }
      continue
    }

    if (!rawJson || rawJson.length < 50) {
      if (attempt === 2) {
        return { status: 'review_required', format, reasons: ['Claude returned an empty response after retry'], partial: null }
      }
      continue
    }

    try {
      analysis = parseJSON(rawJson)
      break  // parsed OK — exit retry loop
    } catch (err) {
      if (attempt === 2) {
        return {
          status:  'review_required',
          format,
          reasons: [`JSON parse failed after retry: ${err.message}`],
          partial: rawJson.substring(0, 500),
        }
      }
      // first attempt failed — retry
    }
  }

  // ── Phase 3: validate coverage ────────────────────────────────────────────

  const coverage = measureCoverage(analysis)

  if (coverage.reasons.length > 0) {
    return { status: 'review_required', format, reasons: coverage.reasons, partial: analysis }
  }

  return { status: 'ok', format, coverage, raw: { lineItems: analysis } }
}
