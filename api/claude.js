export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch (parseErr) {
    console.error('[claude] body parse error:', parseErr.message)
    return res.status(400).json({ error: 'Invalid JSON in request body' })
  }

  if (!body || !body.messages) {
    return res.status(400).json({ error: 'Missing messages in request body' })
  }

  const hasWebSearch = Array.isArray(body.tools) &&
    body.tools.some(t => t.type === 'web_search_20250305')

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  }
  if (hasWebSearch) headers['anthropic-beta'] = 'web-search-2025-03-05'

  // ── Fast path: no web-search tools, single shot ───────────────────────────
  if (!hasWebSearch) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers, body: JSON.stringify(body)
      })
      const data = await response.json()
      return res.status(response.status).json(data)
    } catch (err) {
      console.error('[claude] fast-path error:', err.message)
      return res.status(500).json({ error: err.message })
    }
  }

  // ── Web-search path: tool-use loop ────────────────────────────────────────
  // Anthropic executes the web search server-side. When stop_reason is
  // 'tool_use', the response content already contains the search results
  // inside tool_use blocks. We must echo them back as tool_result blocks
  // so Claude can compose its final text answer.
  // Loop cap: 5 turns (web search normally resolves in 2-3).
  try {
    const messages = [...body.messages]
    const MAX_TURNS = 5
    const loopStart = Date.now()
    const SOFT_TIMEOUT_MS = 240_000 // 240s — graceful exit before Vercel's 300s hard kill

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (Date.now() - loopStart > SOFT_TIMEOUT_MS) {
        console.warn('[claude] soft timeout reached after', Math.round((Date.now() - loopStart) / 1000), 's')
        return res.status(200).json({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'The web search is taking longer than expected. Please try again — results are usually faster on a second attempt.' }],
        })
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, messages }),
      })

      const data = await response.json()

      if (!response.ok) {
        // Anthropic returned an error (4xx/5xx) — surface it as-is
        return res.status(response.status).json(data)
      }

      const stopReason = data.stop_reason

      if (stopReason === 'end_turn') {
        // Final response — return in the same shape as the single-shot path
        return res.status(200).json(data)
      }

      if (stopReason === 'tool_use') {
        // Append assistant turn (contains tool_use blocks with search results)
        messages.push({ role: 'assistant', content: data.content })

        // Build tool_result blocks: one per tool_use block in the response.
        // For server-executed tools (web_search), the results are already
        // embedded in the tool_use block's content field by Anthropic.
        const toolResults = data.content
          .filter(block => block.type === 'tool_use')
          .map(block => ({
            type: 'tool_result',
            tool_use_id: block.id,
            content: block.content ?? '',
          }))

        if (toolResults.length === 0) {
          // No actionable tool calls — treat whatever text is present as final
          return res.status(200).json(data)
        }

        // Append user turn with tool results to continue the conversation
        messages.push({ role: 'user', content: toolResults })
        continue
      }

      // Any other stop_reason (e.g. max_tokens, stop_sequence) — return as-is
      return res.status(200).json(data)
    }

    // Exceeded MAX_TURNS without end_turn — return whatever we have
    return res.status(200).json({ error: 'Web search loop exceeded max turns without a final response' })

  } catch (err) {
    console.error('[claude] web-search loop error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
