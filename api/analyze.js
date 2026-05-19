export const config = {
  maxDuration: 120,
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { mode, extractedText, pageImages, fileName, companyName } = body;

    let documentText = '';

    if (mode === 'text') {
      // Text PDF — use the pre-extracted text from pdfjs in the browser
      documentText = extractedText || '';

    } else if (mode === 'vision') {
      // Scanned PDF — send page images to Claude vision for OCR
      const visionContent = [];
      for (let i = 0; i < pageImages.length; i++) {
        visionContent.push({ type: 'text', text: `Page ${i + 1}:` });
        visionContent.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: pageImages[i] }
        });
      }
      visionContent.push({
        type: 'text',
        text: 'Extract ALL text from these financial document pages exactly as it appears. Include every number, table, label, and footnote. Preserve table structure using | as column separator. Output raw extracted text only.'
      });

      const ocrResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250514',
          max_tokens: 8192,
          messages: [{ role: 'user', content: visionContent }]
        })
      });

      const ocrData = await ocrResponse.json();
      documentText = ocrData?.content?.[0]?.text || '';

    } else {
      return res.status(400).json({ error: 'Invalid mode. Expected "text" or "vision".' });
    }

    if (!documentText || documentText.replace(/\s/g, '').length < 200) {
      return res.status(422).json({
        error: 'Could not extract text from document. If this is a scanned PDF, please ensure it is not password-protected.'
      });
    }

    // Smart trim — find financial section and focus on it (Change 1)
    let textToAnalyze = documentText;
    const MARKERS = [
      'balance sheet', 'profit and loss', 'statement of profit',
      'income statement', 'financial statement', 'standalone financial',
      'consolidated financial', 'profit & loss'
    ];
    const lowerText = documentText.toLowerCase();
    let financialStart = -1;
    for (const marker of MARKERS) {
      const idx = lowerText.indexOf(marker);
      if (idx !== -1 && (financialStart === -1 || idx < financialStart)) {
        financialStart = idx;
      }
    }
    if (financialStart > 2000) {
      textToAnalyze = documentText.substring(Math.max(0, financialStart - 2000), financialStart + 80000);
    } else {
      textToAnalyze = documentText.substring(0, 80000);
    }

    // Analyse the extracted text
    const analysisResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 4096,
        system: `You are a financial data extraction API. You output ONLY raw JSON.
No prose. No markdown. No code fences. No explanation before or after.
Start your response with { and end with }
If you cannot find a value output null. Never guess or fabricate numbers.`,
        messages: [{
          role: 'user',
          content: `Analyze this private company financial document. Return ONLY valid JSON.
Replace FY2024/FY2023 keys with the actual fiscal years found in the document.

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
  "financial_years": ["FY2024", "FY2023"],
  "income_statement": {
    "revenue":                   {"FY2024": null, "FY2023": null},
    "cost_of_goods_sold":        {"FY2024": null, "FY2023": null},
    "gross_profit":              {"FY2024": null, "FY2023": null},
    "operating_expenses":        {"FY2024": null, "FY2023": null},
    "ebitda":                    {"FY2024": null, "FY2023": null},
    "depreciation_amortization": {"FY2024": null, "FY2023": null},
    "ebit":                      {"FY2024": null, "FY2023": null},
    "interest_expense":          {"FY2024": null, "FY2023": null},
    "pbt":                       {"FY2024": null, "FY2023": null},
    "tax":                       {"FY2024": null, "FY2023": null},
    "net_income":                {"FY2024": null, "FY2023": null}
  },
  "balance_sheet": {
    "cash_equivalents":          {"FY2024": null, "FY2023": null},
    "accounts_receivable":       {"FY2024": null, "FY2023": null},
    "inventory":                 {"FY2024": null, "FY2023": null},
    "total_current_assets":      {"FY2024": null, "FY2023": null},
    "fixed_assets_net":          {"FY2024": null, "FY2023": null},
    "intangibles_goodwill":      {"FY2024": null, "FY2023": null},
    "total_assets":              {"FY2024": null, "FY2023": null},
    "accounts_payable":          {"FY2024": null, "FY2023": null},
    "short_term_debt":           {"FY2024": null, "FY2023": null},
    "total_current_liabilities": {"FY2024": null, "FY2023": null},
    "long_term_debt":            {"FY2024": null, "FY2023": null},
    "total_liabilities":         {"FY2024": null, "FY2023": null},
    "share_capital":             {"FY2024": null, "FY2023": null},
    "retained_earnings":         {"FY2024": null, "FY2023": null},
    "total_equity":              {"FY2024": null, "FY2023": null}
  },
  "cash_flow": {
    "cfo":            {"FY2024": null, "FY2023": null},
    "cfi":            {"FY2024": null, "FY2023": null},
    "cff":            {"FY2024": null, "FY2023": null},
    "capex":          {"FY2024": null, "FY2023": null},
    "free_cash_flow": {"FY2024": null, "FY2023": null}
  },
  "swot": {
    "strengths":     ["4-6 evidence-based points"],
    "weaknesses":    ["4-6 evidence-based points"],
    "opportunities": ["4-6 evidence-based points"],
    "threats":       ["4-6 evidence-based points"]
  },
  "key_observations": ["5-8 data-driven observations"],
  "data_quality_notes": ["any gaps or assumptions"]
}

DOCUMENT TEXT:
${textToAnalyze}`
        }]
      })
    });

    const analysisData = await analysisResponse.json();

    // Change 5 — check for Claude API errors before parsing
    if (analysisData?.error) {
      throw new Error('Claude API error: ' + (analysisData.error.message || JSON.stringify(analysisData.error)));
    }

    let rawJson = analysisData?.content?.[0]?.text || '';

    // Change 4 — log what Claude returned for debugging
    console.log('[analyze] Claude response length:', rawJson.length);
    console.log('[analyze] Claude response preview:', rawJson.substring(0, 300));

    if (!rawJson || rawJson.length < 50) {
      throw new Error('Claude returned empty response. The document may be too large or unreadable.');
    }

    // Change 3 — resilient JSON parser
    const parseJSON = (text) => {
      let cleaned = text
        .replace(/^```(?:json)?\s*/gm, '')
        .replace(/```\s*$/gm, '')
        .trim();

      try { return JSON.parse(cleaned); } catch (e1) {}

      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const jsonStr = cleaned.substring(firstBrace, lastBrace + 1);
        try { return JSON.parse(jsonStr); } catch (e2) {}

        // Try to fix truncated JSON — remove everything after the last complete field
        const truncated = jsonStr.replace(/,\s*"[^"]*"\s*:\s*[^,}\]]*$/, '}');
        try { return JSON.parse(truncated); } catch (e3) {}

        // Last resort — close unclosed brackets/braces
        let fixed = jsonStr;
        const openBraces    = (fixed.match(/\{/g) || []).length;
        const closeBraces   = (fixed.match(/\}/g) || []).length;
        const openBrackets  = (fixed.match(/\[/g) || []).length;
        const closeBrackets = (fixed.match(/\]/g) || []).length;
        fixed += ']'.repeat(Math.max(0, openBrackets - closeBrackets));
        fixed += '}'.repeat(Math.max(0, openBraces - closeBraces));
        try { return JSON.parse(fixed); } catch (e4) {}
      }

      throw new Error('Could not parse Claude response as JSON. Response preview: ' + text.substring(0, 200));
    };

    let analysis;
    try {
      analysis = parseJSON(rawJson);
    } catch (parseErr) {
      console.error('[analyze] Parse error:', parseErr.message);
      console.error('[analyze] Raw response preview:', rawJson.substring(0, 500));
      return res.status(500).json({
        error: 'Analysis failed — the document may be too complex. Try uploading just the financial statements pages.',
        debug: rawJson.substring(0, 300)
      });
    }

    if (companyName && analysis.company_profile) {
      analysis.company_profile.name = companyName;
    }

    const ratiosByYear = calculateRatios(analysis);

    return res.status(200).json({
      success: true,
      analysis,
      ratiosByYear,
      textLength: documentText.length,
      mode
    });

  } catch (err) {
    console.error('[analyze]', err.message);
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
