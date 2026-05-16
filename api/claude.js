// FinSight AI — Backend API Proxy
// This keeps your Anthropic API key safe on the server

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!API_KEY) {
    return res.status(200).json({
      error: true,
      error_type: "auth",
      message: "API key not configured on the server. Please contact support.",
      fallback_available: true
    });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();

    // Transform non-retryable Anthropic errors into structured responses
    // so the client can degrade gracefully instead of crashing.
    if (response.status === 400) {
      return res.status(200).json({
        error: true,
        error_type: "auth",
        message: data?.error?.message || "API request rejected. The API key may be invalid or lack permissions.",
        fallback_available: true
      });
    }
    if (response.status === 402) {
      return res.status(200).json({
        error: true,
        error_type: "api_credits",
        message: "Insufficient API credits. Please top up your Anthropic account to restore AI analysis.",
        fallback_available: true
      });
    }
    if (response.status === 403) {
      return res.status(200).json({
        error: true,
        error_type: "auth",
        message: data?.error?.message || "Access denied. Check API key permissions.",
        fallback_available: true
      });
    }
    // 429 / 503 / 529 are retried by callClaude on the client — pass through with original status
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(200).json({
      error: true,
      error_type: "server",
      message: error.message || "Internal server error connecting to Anthropic.",
      fallback_available: true
    });
  }
}
