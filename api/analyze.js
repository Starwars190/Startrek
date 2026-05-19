export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { fileBase64, fileName, fileType, companyName } = body;

    if (!fileBase64) return res.status(400).json({ error: 'No file provided' });

    // Step 1: Extract text via Claude document API
    const extractResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 8192,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: fileType || 'application/pdf',
                data: fileBase64
              }
            },
            {
              type: 'text',
              text: 'Extract ALL text from this financial document exactly as it appears. Include every number, table, heading, footnote and label. Preserve table structure using | as separator. Output raw extracted text only, no commentary.'
            }
          ]
        }]
      })
    });

    const extractData = await extractResponse.json();
    const extractedText = extractData?.content?.[0]?.text || '';

    if (!extractedText || extractedText.length < 100) {
      return res.status(422).json({ error: 'Could not extract text from document. Please ensure it is a readable PDF.' });
    }

    // Step 2: Analyse financials
    const analysisResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 8192,
        system: `You are a senior financial analyst. Extract structured financial data from private company documents.
RULES:
1. Extract EVERY number you find. Never invent figures.
2. If a value is missing use null — NEVER fabricate.
3. Return ONLY valid JSON. No markdown, no explanation.
4. Use actual fiscal years found in the document.`,
        messages: [{
          role: 'user',
          content: `Analyze this private company financial document. Return ONLY this JSON with actual year keys (e.g. FY2023, FY2022) found in the document:

{
  "company_profile": {
    "name": "string or null",
    "industry": "string or null",
    "sub_industry": "string or null",
    "headquarters": "string or null",
    "year_founded": "string or null",
    "legal_structure": "string or null",
    "reporting_currency": "string",
    "reporting_unit": "e.g. INR Lakhs or USD Thousands",
    "fiscal_year_end": "string or null",
    "auditor": "string or null",
    "description": "2-3 sentence description from document only",
    "key_products_services": ["max 5"],
    "number_of_employees": "string or null",
    "geographic_presence": ["list or empty"]
  },
  "financial_years": ["FY2023", "FY2022"],
  "income_statement": {
    "revenue":                   {"FY2023": null, "FY2022": null},
    "cost_of_goods_sold":        {"FY2023": null, "FY2022": null},
    "gross_profit":              {"FY2023": null, "FY2022": null},
    "operating_expenses":        {"FY2023": null, "FY2022": null},
    "ebitda":                    {"FY2023": null, "FY2022": null},
    "depreciation_amortization": {"FY2023": null, "FY2022": null},
    "ebit":                      {"FY2023": null, "FY2022": null},
    "interest_expense":          {"FY2023": null, "FY2022": null},
    "pbt":                       {"FY2023": null, "FY2022": null},
    "tax":                       {"FY2023": null, "FY2022": null},
    "net_income":                {"FY2023": null, "FY2022": null}
  },
  "balance_sheet": {
    "cash_equivalents":          {"FY2023": null, "FY2022": null},
    "accounts_receivable":       {"FY2023": null, "FY2022": null},
    "inventory":                 {"FY2023": null, "FY2022": null},
    "total_current_assets":      {"FY2023": null, "FY2022": null},
    "fixed_assets_net":          {"FY2023": null, "FY2022": null},
    "intangibles_goodwill":      {"FY2023": null, "FY2022": null},
    "total_assets":              {"FY2023": null, "FY2022": null},
    "accounts_payable":          {"FY2023": null, "FY2022": null},
    "short_term_debt":           {"FY2023": null, "FY2022": null},
    "total_current_liabilities": {"FY2023": null, "FY2022": null},
    "long_term_debt":            {"FY2023": null, "FY2022": null},
    "total_liabilities":         {"FY2023": null, "FY2022": null},
    "share_capital":             {"FY2023": null, "FY2022": null},
    "retained_earnings":         {"FY2023": null, "FY2022": null},
    "total_equity":              {"FY2023": null, "FY2022": null}
  },
  "cash_flow": {
    "cfo":            {"FY2023": null, "FY2022": null},
    "cfi":            {"FY2023": null, "FY2022": null},
    "cff":            {"FY2023": null, "FY2022": null},
    "capex":          {"FY2023": null, "FY2022": null},
    "free_cash_flow": {"FY2023": null, "FY2022": null}
  },
  "swot": {
    "strengths":     ["4-6 evidence-based points from document only"],
    "weaknesses":    ["4-6 evidence-based points from document only"],
    "opportunities": ["4-6 evidence-based points from document only"],
    "threats":       ["4-6 evidence-based points from document only"]
  },
  "key_observations": ["5-8 data-driven analyst observations"],
  "data_quality_notes": ["any gaps or assumptions"]
}

DOCUMENT TEXT:
${extractedText}`
        }]
      })
    });

    const analysisData = await analysisResponse.json();
    let rawJson = analysisData?.content?.[0]?.text || '';
    rawJson = rawJson.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();

    let analysis;
    try {
      analysis = JSON.parse(rawJson);
    } catch (e) {
      const match = rawJson.match(/\{[\s\S]*\}/);
      if (match) analysis = JSON.parse(match[0]);
      else throw new Error('Could not parse analysis response');
    }

    if (companyName && analysis.company_profile) {
      analysis.company_profile.name = companyName;
    }

    const ratiosByYear = calculateRatios(analysis);

    return res.status(200).json({
      success: true,
      analysis,
      ratiosByYear,
      extractedTextLength: extractedText.length
    });

  } catch (err) {
    console.error('[analyze]', err);
    return res.status(500).json({ error: err.message });
  }
}

function calculateRatios(data) {
  const years = data.financial_years || [];
  const result = {};
  for (const yr of years) {
    const is_ = data.income_statement || {};
    const bs_ = data.balance_sheet    || {};
    const cf_ = data.cash_flow        || {};
    const g = (s, k) => { const v = s[k]?.[yr]; if (v == null) return null; const n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? null : n; };
    const div = (a, b) => (a != null && b != null && b !== 0) ? Math.round(a / b * 10000) / 10000 : null;
    const pct = (a, b) => { const v = div(a, b); return v != null ? Math.round(v * 10000) / 100 : null; };
    const rev = g(is_, 'revenue'), gp = g(is_, 'gross_profit'), ebitda = g(is_, 'ebitda'), ebit = g(is_, 'ebit');
    const ni = g(is_, 'net_income'), ie = g(is_, 'interest_expense');
    const ta = g(bs_, 'total_assets'), ca = g(bs_, 'total_current_assets'), cl = g(bs_, 'total_current_liabilities');
    const inv = g(bs_, 'inventory'), ar = g(bs_, 'accounts_receivable'), ap = g(bs_, 'accounts_payable');
    const cash = g(bs_, 'cash_equivalents'), eq = g(bs_, 'total_equity');
    const ltd = g(bs_, 'long_term_debt'), std = g(bs_, 'short_term_debt'), fa = g(bs_, 'fixed_assets_net');
    const cfo = g(cf_, 'cfo'), capex = g(cf_, 'capex'), fcf = g(cf_, 'free_cash_flow');
    const debt = ltd != null && std != null ? ltd + std : (ltd ?? std);
    const netDebt = debt != null && cash != null ? debt - cash : null;
    const r = {};
    r['Gross Margin %'] = pct(gp, rev); r['EBITDA Margin %'] = pct(ebitda, rev); r['EBIT Margin %'] = pct(ebit, rev);
    r['Net Profit Margin %'] = pct(ni, rev); r['Return on Assets %'] = pct(ni, ta); r['Return on Equity %'] = pct(ni, eq);
    r['Return on Capital Employed %'] = (ebit != null && ta != null && cl != null) ? pct(ebit, ta - cl) : null;
    r['Asset Turnover'] = div(rev, ta); r['Current Ratio'] = div(ca, cl);
    r['Quick Ratio'] = (ca != null && inv != null) ? div(ca - inv, cl) : div(ca, cl);
    r['Cash Ratio'] = div(cash, cl); r['Operating CF Ratio'] = div(cfo, cl);
    r['Debt to Equity'] = div(debt, eq); r['Total Debt to Assets %'] = pct(debt, ta); r['Equity Ratio %'] = pct(eq, ta);
    r['Debt to EBITDA'] = div(debt, ebitda); r['Net Debt to EBITDA'] = div(netDebt, ebitda);
    r['Interest Cover (EBIT)'] = div(ebit, ie); r['Interest Cover (EBITDA)'] = div(ebitda, ie);
    r['Inventory Days'] = (inv != null && g(is_, 'cost_of_goods_sold') != null) ? Math.round(div(inv, g(is_, 'cost_of_goods_sold')) * 365 * 10) / 10 : null;
    r['Receivables Days (DSO)'] = (ar != null && rev != null) ? Math.round(div(ar, rev) * 365 * 10) / 10 : null;
    r['Payables Days (DPO)'] = (ap != null && g(is_, 'cost_of_goods_sold') != null) ? Math.round(div(ap, g(is_, 'cost_of_goods_sold')) * 365 * 10) / 10 : null;
    r['Fixed Asset Turnover'] = div(rev, fa); r['FCF Margin %'] = pct(fcf, rev);
    r['Capex to Revenue %'] = pct(capex, rev); r['CFO to Net Income'] = div(cfo, ni);
    const prevYr = years[years.indexOf(yr) - 1];
    if (prevYr) {
      const gp2 = (s, k) => { const v = s[k]?.[prevYr]; if (v == null) return null; const n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? null : n; };
      const rp = gp2(is_, 'revenue'), nip = gp2(is_, 'net_income'), ep = gp2(is_, 'ebitda');
      r['Revenue Growth %'] = (rev != null && rp != null && rp !== 0) ? Math.round((rev - rp) / Math.abs(rp) * 10000) / 100 : null;
      r['Net Income Growth %'] = (ni != null && nip != null && nip !== 0) ? Math.round((ni - nip) / Math.abs(nip) * 10000) / 100 : null;
      r['EBITDA Growth %'] = (ebitda != null && ep != null && ep !== 0) ? Math.round((ebitda - ep) / Math.abs(ep) * 10000) / 100 : null;
    }
    result[yr] = r;
  }
  return result;
}
